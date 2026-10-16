import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LEGACY_NAMES = ["kiwi-desktop", "Kiwi"] as const;

export type LegacyName = (typeof LEGACY_NAMES)[number];

export type LegacyPassword = (name: LegacyName) => Promise<string | null>;

export type LegacyRead = { kind: "none" } | { kind: "ok"; json: Record<string, unknown>; file: string; encrypted: boolean } | { kind: "unreadable"; file: string; why: string };

const PREFIXES = ["v10", "v11"] as const;

type Prefix = (typeof PREFIXES)[number];

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

export async function readLegacyAt(file: string, name: LegacyName, rounds: number, password: LegacyPassword): Promise<LegacyRead> {
  let raw: Uint8Array;
  try {
    raw = fs.readFileSync(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { kind: "none" };
    return { kind: "unreadable", file, why: reason(e) };
  }
  if (!legacyPrefix(raw)) {
    try {
      return { kind: "ok", json: storeObject(new TextDecoder("utf-8", { fatal: true }).decode(raw)), file, encrypted: false };
    } catch (e) {
      return { kind: "unreadable", file, why: reason(e) };
    }
  }
  const pw = await password(name).catch(() => null);
  if (pw === null) return { kind: "unreadable", file, why: `the system keychain didn't give Kiwi the key it saved as "${name} Safe Storage"` };
  try {
    return { kind: "ok", json: storeObject(await openLegacy(raw, pw, rounds)), file, encrypted: true };
  } catch (e) {
    return { kind: "unreadable", file, why: `the key from the system keychain didn't open it (${reason(e)})` };
  }
}

export async function readLegacyStore(password: LegacyPassword, platform: NodeJS.Platform = process.platform, home: string = os.homedir(), env: NodeJS.ProcessEnv = process.env): Promise<LegacyRead> {
  let first: LegacyRead = { kind: "none" };
  for (const { name, dir } of legacyDirs(platform, home, env)) {
    const read = await readLegacyAt(path.join(dir, "kiwi-store.bin"), name, legacyRounds(platform), password);
    if (read.kind === "ok") return read;
    if (first.kind === "none") first = read;
  }
  return first;
}
