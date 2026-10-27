import { execFile } from "node:child_process";

import { CString, dlopen, FFIType, ptr, type Pointer } from "bun:ffi";

import type { LegacyName, LegacyPassword } from "./legacy-store.ts";
import { childEnv } from "./child-env.ts";

const SCHEMA = "chrome_libsecret_os_crypt_password_v2";
const DONT_MATCH_NAME = 2;

const SCHEMA_SIZE = 592;

const cstr = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(`${s}\0`);

function libsecretLookup(application: string): string | null {
  const libc = dlopen("libc.so.6", {
    dlopen: { args: [FFIType.cstring, FFIType.i32], returns: FFIType.ptr },
    dlsym: { args: [FFIType.ptr, FFIType.cstring], returns: FFIType.ptr },
  });
  const glib = libc.symbols.dlopen(cstr("libglib-2.0.so.0"), 2);
  const strHash = glib ? libc.symbols.dlsym(glib, cstr("g_str_hash")) : null;
  const strEqual = glib ? libc.symbols.dlsym(glib, cstr("g_str_equal")) : null;
  libc.close();
  if (!strHash || !strEqual) return null;
  const g = dlopen("libglib-2.0.so.0", {
    g_hash_table_new: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    g_hash_table_insert: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    g_hash_table_unref: { args: [FFIType.ptr], returns: FFIType.void },
  });
  const s = dlopen("libsecret-1.so.0", {
    secret_password_lookupv_sync: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    secret_password_free: { args: [FFIType.ptr], returns: FFIType.void },
  });
  const schemaName = cstr(SCHEMA);
  const attrName = cstr("application");
  const attrValue = cstr(application);
  const nameAt = SCHEMA_SIZE;
  const keyAt = nameAt + schemaName.length;
  const valueAt = keyAt + attrName.length;
  const arena = new Uint8Array(valueAt + attrValue.length);
  arena.set(schemaName, nameAt);
  arena.set(attrName, keyAt);
  arena.set(attrValue, valueAt);
  const base = ptr(arena);
  const at = (offset: number): Pointer => (base + offset) as Pointer;
  const fields = new DataView(arena.buffer);
  fields.setBigUint64(0, BigInt(at(nameAt)), true);
  fields.setInt32(8, DONT_MATCH_NAME, true);
  fields.setBigUint64(16, BigInt(at(keyAt)), true);
  fields.setInt32(24, 0, true);
  const table = g.symbols.g_hash_table_new(strHash, strEqual);
  try {
    if (!table) return null;
    g.symbols.g_hash_table_insert(table, at(keyAt), at(valueAt));
    const found = s.symbols.secret_password_lookupv_sync(arena, table, null, null);
    if (!found) return null;
    const value = new CString(found as Pointer).toString();
    s.symbols.secret_password_free(found);
    return value;
  } finally {
    if (table) g.symbols.g_hash_table_unref(table);
    s.close();
    g.close();
  }
}

export type DBusCall = (dest: string, path: string, method: string, args: readonly string[], timeoutMs: number) => Promise<string | null>;

const KWALLETS = [
  ["org.kde.kwalletd6", "/modules/kwalletd6"],
  ["org.kde.kwalletd5", "/modules/kwalletd5"],
  ["org.kde.kwalletd", "/modules/kwalletd"],
] as const;
const OPEN_MS = 120_000;
const CALL_MS = 10_000;

const dbusSend: DBusCall = (dest, path, method, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      "dbus-send",
      ["--session", "--print-reply", `--reply-timeout=${timeoutMs}`, `--dest=${dest}`, path, `org.kde.KWallet.${method}`, ...args],
      { timeout: timeoutMs + 5_000, env: childEnv() },
      (err, stdout) => resolve(err ? null : stdout),
    );
  });

export function replyValue(out: string | null): string | null {
  const m = /^\s+(?:string "(.*)"|(?:int32|int64|boolean) (\S+))\s*$/m.exec(out ?? "");
  return m ? (m[1] ?? m[2] ?? null) : null;
}

export const legacyPairs = (name: LegacyName): [string, string][] =>
  [`${name} Keys`, "Chromium Keys"].flatMap((folder): [string, string][] => [`${name} Safe Storage`, "Chromium Safe Storage"].map((key): [string, string] => [folder, key]));

export async function kwalletKeys(name: LegacyName, call: DBusCall = dbusSend): Promise<string[]> {
  for (const [dest, path] of KWALLETS) {
    if (replyValue(await call(dest, path, "isEnabled", [], CALL_MS)) !== "true") continue;
    const wallet = replyValue(await call(dest, path, "networkWallet", [], CALL_MS)) || "kdewallet";
    const handle = Number(replyValue(await call(dest, path, "open", [`string:${wallet}`, "int64:0", `string:${name}`], OPEN_MS)));
    if (!Number.isInteger(handle) || handle < 0) continue;
    const found: string[] = [];
    try {
      for (const [folder, key] of legacyPairs(name)) {
        const value = replyValue(await call(dest, path, "readPassword", [`int32:${handle}`, `string:${folder}`, `string:${key}`, `string:${name}`], CALL_MS));
        if (value && !found.includes(value)) found.push(value);
      }
    } finally {
      await call(dest, path, "close", [`int32:${handle}`, "boolean:false", `string:${name}`], CALL_MS);
    }
    if (found.length) return found;
  }
  return [];
}

function libsecretKeys(name: LegacyName): string[] {
  const found: string[] = [];
  for (const application of [name, "chromium"]) {
    try {
      const value = libsecretLookup(application);
      if (value && !found.includes(value)) found.push(value);
    } catch {
      // No libsecret or GLib on this computer: KDE's wallet is the other place Chromium keeps the key.
      return found;
    }
  }
  return found;
}

export const legacyPassword =
  (platform: NodeJS.Platform = process.platform, kwallet: (name: LegacyName) => Promise<string[]> = kwalletKeys, libsecret: (name: LegacyName) => string[] = libsecretKeys): LegacyPassword =>
  async (name) => {
    if (platform !== "linux") return [];
    const keys = [...libsecret(name)];
    for (const key of await kwallet(name)) if (!keys.includes(key)) keys.push(key);
    return keys;
  };
