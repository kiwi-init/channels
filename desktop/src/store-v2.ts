import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { chooseStore, needsResave, readStore, writePrivate } from "./guard.ts";
import type { LegacyRead } from "./legacy-store.ts";

export const STORE_FILE = "kiwi-store-v2.bin";

const MAGIC = Buffer.from("kiwi-store/2\n", "latin1");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface StoreKey {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
}

export const keychainKey = (service: string = "Channels", name: string = "store-key"): StoreKey => ({
  get: () => Bun.secrets.get({ service, name }),
  set: (value) => Bun.secrets.set({ service, name, value }),
});

export type OpenStore =
  | { kind: "open"; json: Record<string, unknown> | null; sealed: boolean; imported: string | null; file: string; save: (json: string) => void }
  | { kind: "unreadable"; why: string; file: string };

export interface StoreOptions {
  dir: string;
  key: StoreKey;
  legacy: () => Promise<LegacyRead>;
  platform?: NodeJS.Platform;
}

type Lookup = { kind: "key"; key: Buffer } | { kind: "none" } | { kind: "failed"; why: string };

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const isSealed = (raw: Uint8Array): boolean => raw.length >= MAGIC.length && MAGIC.equals(raw.subarray(0, MAGIC.length));

export function seal(json: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  return Buffer.concat([MAGIC, iv, body, cipher.getAuthTag()]);
}

export function unseal(raw: Buffer, key: Buffer): string {
  if (!isSealed(raw) || raw.length < MAGIC.length + IV_BYTES + TAG_BYTES) throw new Error("not a sealed store");
  const iv = raw.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
  const plain = Buffer.concat([decipher.update(raw.subarray(MAGIC.length + IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]);
  return new TextDecoder("utf-8", { fatal: true }).decode(plain);
}

async function lookup(source: StoreKey): Promise<Lookup> {
  let value: string | null;
  try {
    value = await source.get();
  } catch (e) {
    return { kind: "failed", why: reason(e) };
  }
  if (value === null) return { kind: "none" };
  const key = Buffer.from(value, "base64");
  return key.length === KEY_BYTES && key.toString("base64") === value ? { kind: "key", key } : { kind: "failed", why: "the key it holds isn't 32 bytes in base64" };
}

async function create(source: StoreKey): Promise<Lookup> {
  const key = randomBytes(KEY_BYTES);
  try {
    await source.set(key.toString("base64"));
  } catch (e) {
    return { kind: "failed", why: reason(e) };
  }
  return { kind: "key", key };
}

function bytes(file: string): Buffer | null {
  try {
    return fs.readFileSync(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function openStore({ dir, key, legacy, platform = process.platform }: StoreOptions): Promise<OpenStore> {
  const file = path.join(dir, STORE_FILE);
  const backup = `${file}.bak`;
  const refuse = (why: string): OpenStore => ({ kind: "unreadable", why, file });
  try {
    const main = bytes(file);
    const back = bytes(backup);
    const sealed = [main, back].some((b) => b !== null && isSealed(b));
    let found = await lookup(key);
    if (found.kind === "none") found = sealed ? { kind: "failed", why: "it holds no store key" } : await create(key);
    if (found.kind === "failed" && (sealed || platform !== "linux")) return refuse(`the system keychain didn't give Channels its store key: ${found.why}`);
    const k = found.kind === "key" ? found.key : null;
    const save = (json: string): void => {
      const raw = k ? seal(json, k) : Buffer.from(json, "utf8");
      writePrivate(file, raw, platform);
      writePrivate(backup, raw, platform);
    };
    const open = (json: Record<string, unknown> | null, imported: string | null): OpenStore => ({ kind: "open", json, sealed: k !== null, imported, file, save });
    if (main === null && back === null) {
      const old = await legacy();
      if (old.kind === "none") return open(null, null);
      if (old.kind === "unreadable") return refuse(`the keys the Electron app saved in ${old.file} can't be read: ${old.why}`);
      save(JSON.stringify(old.json));
      return open(old.json, old.file);
    }
    const decrypt = k ? (b: Buffer) => unseal(b, k) : null;
    const choice = chooseStore(main, back, decrypt);
    const read = choice.read.kind === "none" && back ? readStore(back, decrypt) : choice.read;
    if (read.kind !== "ok") return refuse(read.kind === "unreadable" ? read.why : "it has no store");
    if (!isRecord(read.json)) return refuse("not a store");
    if (choice.restore) writePrivate(file, choice.restore, platform);
    if (needsResave(platform, choice.restore ?? main, read, k ? "keyring" : "plain")) save(JSON.stringify(read.json));
    return open(read.json, null);
  } catch (e) {
    return refuse(reason(e));
  }
}
