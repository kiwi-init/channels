import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LEGACY_NAMES = ["kiwi-desktop", "Kiwi"] as const;

export type LegacyName = (typeof LEGACY_NAMES)[number];

export type LegacyPassword = (name: LegacyName) => Promise<string | null>;

export type LegacyRead = { kind: "none" } | { kind: "ok"; json: Record<string, unknown>; file: string; encrypted: boolean } | { kind: "unreadable"; file: string; why: string; keyless?: true };

const PREFIXES = ["v10", "v11"] as const;

type Prefix = (typeof PREFIXES)[number];

const LINUX_V10_PASSWORD = "peanuts";

const LEGACY_FILES = ["kiwi-store.bin", "kiwi-store.bin.bak"] as const;

export function legacyPrefix(raw: Uint8Array): Prefix | null {
  const head = new TextDecoder().decode(raw.subarray(0, 3));
  return PREFIXES.find((p) => p === head) ?? null;
}

export const legacyRounds = (platform: NodeJS.Platform): number => (platform === "darwin" ? 1003 : 1);

export async function openLegacy(raw: Uint8Array, password: string, rounds: number): Promise<string> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-1", salt: enc.encode("saltysalt"), iterations: rounds }, base, { name: "AES-CBC", length: 128 }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv: new Uint8Array(16).fill(0x20) }, key, new Uint8Array(raw.subarray(3)));
  return new TextDecoder("utf-8", { fatal: true }).decode(plain);
}

export function legacyDirs(platform: NodeJS.Platform, home: string = os.homedir(), env: NodeJS.ProcessEnv = process.env): { name: LegacyName; dir: string }[] {
  const base = platform === "darwin" ? path.join(home, "Library", "Application Support") : env["XDG_CONFIG_HOME"] || path.join(home, ".config");
  return LEGACY_NAMES.map((name) => ({ name, dir: path.join(base, name) }));
}

function storeObject(text: string): Record<string, unknown> {
  const v: unknown = JSON.parse(text);
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not a store");
  return v as Record<string, unknown>;
}

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function legacyKey(prefix: Prefix, name: LegacyName, platform: NodeJS.Platform, password: LegacyPassword): Promise<string | null> {
  if (platform === "linux" && prefix === "v10") return Promise.resolve(LINUX_V10_PASSWORD);
  return password(name).catch(() => null);
}

export async function readLegacyAt(file: string, name: LegacyName, platform: NodeJS.Platform, password: LegacyPassword): Promise<LegacyRead> {
  let raw: Uint8Array;
  try {
    raw = fs.readFileSync(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { kind: "none" };
    return { kind: "unreadable", file, why: reason(e) };
  }
  const prefix = legacyPrefix(raw);
  if (!prefix) {
    try {
      return { kind: "ok", json: storeObject(new TextDecoder("utf-8", { fatal: true }).decode(raw)), file, encrypted: false };
    } catch (e) {
      return { kind: "unreadable", file, why: reason(e) };
    }
  }
  const pw = await legacyKey(prefix, name, platform, password);
  if (pw === null) return { kind: "unreadable", file, why: `the system keychain didn't give Channels the key the old app saved as "${name} Safe Storage"`, keyless: true };
  try {
    return { kind: "ok", json: storeObject(await openLegacy(raw, pw, legacyRounds(platform))), file, encrypted: !(platform === "linux" && prefix === "v10") };
  } catch (e) {
    return { kind: "unreadable", file, why: `its key didn't open it (${reason(e)})` };
  }
}

export async function readLegacyStore(password: LegacyPassword, platform: NodeJS.Platform = process.platform, home: string = os.homedir(), env: NodeJS.ProcessEnv = process.env): Promise<LegacyRead> {
  const asked = new Map<LegacyName, Promise<string | null>>();
  const once: LegacyPassword = (name) => {
    const had = asked.get(name);
    if (had) return had;
    const next = password(name);
    asked.set(name, next);
    return next;
  };
  for (const { name, dir } of legacyDirs(platform, home, env)) {
    let unreadable: LegacyRead | null = null;
    for (const file of LEGACY_FILES) {
      const read = await readLegacyAt(path.join(dir, file), name, platform, once);
      if (read.kind === "ok") return read;
      if (read.kind !== "unreadable") continue;
      if (!unreadable) unreadable = read;
      if (read.keyless) break;
    }
    if (unreadable) return unreadable;
  }
  return { kind: "none" };
}
