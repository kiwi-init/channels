import { execFile } from "node:child_process";

import { CString, dlopen, FFIType, ptr, type Pointer } from "bun:ffi";

import type { LegacyName, LegacyPassword } from "./legacy-store.ts";

const SCHEMA = "chrome_libsecret_os_crypt_password_v2";
const DONT_MATCH_NAME = 2;

const cstr = (s: string): Buffer => Buffer.from(`${s}\0`, "utf8");

function libsecretLookup(application: string): string | null {
  const libc = dlopen("libc.so.6", {
    dlopen: { args: [FFIType.cstring, FFIType.i32], returns: FFIType.ptr },
    dlsym: { args: [FFIType.ptr, FFIType.cstring], returns: FFIType.ptr },
  });
  const glibPath = cstr("libglib-2.0.so.0");
  const glib = libc.symbols.dlopen(ptr(glibPath), 2);
  const strHash = glib ? libc.symbols.dlsym(glib, ptr(cstr("g_str_hash"))) : null;
  const strEqual = glib ? libc.symbols.dlsym(glib, ptr(cstr("g_str_equal"))) : null;
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
  const schema = Buffer.alloc(592);
  schema.writeBigUInt64LE(BigInt(ptr(schemaName)), 0);
  schema.writeInt32LE(DONT_MATCH_NAME, 8);
  schema.writeBigUInt64LE(BigInt(ptr(attrName)), 16);
  schema.writeInt32LE(0, 24);
  const table = g.symbols.g_hash_table_new(strHash, strEqual);
  try {
    if (!table) return null;
    g.symbols.g_hash_table_insert(table, ptr(attrName), ptr(attrValue));
    const found = s.symbols.secret_password_lookupv_sync(ptr(schema), table, null, null);
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

function kwalletLookup(name: LegacyName): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("kwallet-query", ["-r", `${name} Safe Storage`, "-f", `${name} Keys`, "kdewallet"], { timeout: 30_000 }, (err, stdout) => {
      const v = stdout.trim();
      resolve(err || !v || v.startsWith("Failed") ? null : v);
    });
  });
}

function libsecretOrNull(name: LegacyName): string | null {
  try {
    return libsecretLookup(name);
  } catch {
    // No libsecret or GLib on this computer: KDE's wallet is the other place Chromium keeps the key.
    return null;
  }
}

export const macKeychainItem = (name: LegacyName): { service: string; name: string } => ({ service: `${name} Safe Storage`, name: `${name} Key` });

export const legacyPassword =
  (platform: NodeJS.Platform = process.platform): LegacyPassword =>
  async (name) => {
    if (platform === "darwin") return Bun.secrets.get(macKeychainItem(name));
    if (platform !== "linux") return null;
    return libsecretOrNull(name) ?? kwalletLookup(name);
  };
