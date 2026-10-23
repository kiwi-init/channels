import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { writePrivate } from "./guard.ts";
import type { LegacyRead } from "./legacy-store.ts";

export const STORE_FILE = "kiwi-store-v2.bin";

const MAGIC = Buffer.from("kiwi-store/2\n", "latin1");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface StoreKey {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  drop(): Promise<void>;
  finished(): Promise<boolean>;
  finish(): Promise<void>;
}

export const keychainKey = (service: string = "Channels", name: string = "store-key"): StoreKey => ({
  get: () => Bun.secrets.get({ service, name }),
  set: (value) => Bun.secrets.set({ service, name, value }),
  drop: async () => {
    await Bun.secrets.delete({ service, name: `${name}-ready` });
    await Bun.secrets.delete({ service, name });
  },
  finished: async () => (await Bun.secrets.get({ service, name: `${name}-ready` })) !== null,
  finish: () => Bun.secrets.set({ service, name: `${name}-ready`, value: "1" }),
});

export type OpenStore =
  | { kind: "open"; json: Record<string, unknown> | null; sealed: boolean; noKeychain: string | null; imported: string | null; file: string; save: (json: string) => void }
  | { kind: "unreadable"; why: string; file: string };

export interface StoreOptions {
  dir: string;
  key: StoreKey;
  legacy: () => Promise<LegacyRead>;
  platform?: NodeJS.Platform;
}

type Lookup = { kind: "key"; key: Buffer } | { kind: "none" } | { kind: "failed"; why: string };

type Copy = { kind: "none" } | { kind: "ok"; json: Record<string, unknown>; sealed: boolean } | { kind: "unreadable"; why: string };

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

function storeObject(text: string): Record<string, unknown> {
  const v: unknown = JSON.parse(text);
  if (!isRecord(v)) throw new Error("not a store");
  return v;
}

function readCopy(raw: Buffer | null, key: Buffer | null, plainOk: boolean): Copy {
  if (raw === null) return { kind: "none" };
  try {
    if (isSealed(raw)) return key ? { kind: "ok", json: storeObject(unseal(raw, key)), sealed: true } : { kind: "unreadable", why: "it's sealed, and Channels has no key for it" };
    if (!plainOk) return { kind: "unreadable", why: "a copy in plain text where Channels keeps its store sealed" };
    return { kind: "ok", json: storeObject(new TextDecoder("utf-8", { fatal: true }).decode(raw)), sealed: false };
  } catch (e) {
    return { kind: "unreadable", why: reason(e) };
  }
}

async function markFinished(key: StoreKey): Promise<void> {
  try {
    if (!(await key.finished())) await key.finish();
  } catch {
    // The mark is set again by the next start that opens the store, so a keychain that refuses it now loses nothing.
  }
}

async function dropMade(key: StoreKey): Promise<void> {
  try {
    await key.drop();
  } catch {
    // A key left behind stays unfinished, and an unfinished key with no copies is a first run, so the next start carries on with it.
  }
}

export async function openStore({ dir, key, legacy, platform = process.platform }: StoreOptions): Promise<OpenStore> {
  const file = path.join(dir, STORE_FILE);
  const backup = `${file}.bak`;
  const refuse = (why: string): OpenStore => ({ kind: "unreadable", why, file });
  const keychainWhy = (why: string): string => `the system keychain didn't give Channels its store key: ${why}`;
  const saver =
    (k: Buffer | null) =>
    (json: string): void => {
      const raw = k ? seal(json, k) : Buffer.from(json, "utf8");
      writePrivate(file, raw, platform);
      writePrivate(backup, raw, platform);
    };
  const open = (json: Record<string, unknown> | null, imported: string | null, k: Buffer | null, noKeychain: string | null): OpenStore => ({
    kind: "open",
    json,
    sealed: k !== null,
    noKeychain,
    imported,
    file,
    save: saver(k),
  });
  try {
    const main = bytes(file);
    const back = bytes(backup);
    const sealed = [main, back].some((b) => b !== null && isSealed(b));
    const found = await lookup(key);
    if (found.kind === "failed" && (sealed || platform !== "linux")) return refuse(keychainWhy(found.why));
    if (found.kind === "none" && sealed) return refuse(keychainWhy("it holds no store key"));
    if (main === null && back === null) {
      if (found.kind === "key" && platform !== "linux") {
        const done = await key.finished().then(
          (f): { finished: boolean } | { failed: string } => ({ finished: f }),
          (e: unknown) => ({ failed: reason(e) }),
        );
        if ("failed" in done) return refuse(keychainWhy(done.failed));
        if (done.finished)
          return refuse("the store was deleted: the keychain still holds its key but both copies are gone, so Channels neither starts over nor imports the Electron app's keys in its place");
      }
      const old = await legacy();
      if (old.kind === "unreadable") return refuse(`the keys the Electron app saved in ${old.file} can't be read: ${old.why}`);
      if (old.kind === "ok" && !old.encrypted && platform !== "linux")
        return refuse(`the keys in ${old.file} are in plain text, and the Electron app only ever kept them encrypted here, so Channels won't take them`);
      const made = found.kind === "none" ? await create(key) : found;
      if (made.kind === "failed" && platform !== "linux") return refuse(keychainWhy(made.why));
      const k = made.kind === "key" ? made.key : null;
      const noKeychain = made.kind === "failed" ? made.why : null;
      const takeBack = async (why: string): Promise<OpenStore> => {
        fs.rmSync(file, { force: true });
        fs.rmSync(backup, { force: true });
        if (k && made !== found) await dropMade(key);
        return refuse(why);
      };
      if (old.kind === "ok" && old.encrypted && !k)
        return refuse(`the keys the Electron app saved in ${old.file} are encrypted, and without a keychain Channels would keep them in plain text: ${noKeychain}`);
      if (k && made !== found) {
        const kept = await lookup(key);
        if (kept.kind !== "key" || !kept.key.equals(k)) return takeBack(keychainWhy("it didn't keep the store key Channels just made"));
      }
      const json = old.kind === "ok" ? JSON.stringify(old.json) : "{}";
      const unsaved = (() => {
        try {
          saver(k)(json);
          return null;
        } catch (e) {
          return reason(e);
        }
      })();
      if (unsaved !== null) return takeBack(`the new store couldn't be saved: ${unsaved}`);
      const saved = readCopy(bytes(file), k, k === null);
      if (saved.kind !== "ok" || JSON.stringify(saved.json) !== json)
        return takeBack(`the new store didn't read back, so it wasn't kept${old.kind === "ok" ? ` (the keys from ${old.file})` : ""}${saved.kind === "unreadable" ? `: ${saved.why}` : ""}`);
      if (k) await markFinished(key);
      return old.kind === "ok" ? open(old.json, old.file, k, noKeychain) : open(null, null, k, noKeychain);
    }
    let k = found.kind === "key" ? found.key : null;
    let noKeychain = found.kind === "failed" ? found.why : null;
    const plainOk = platform === "linux" && !sealed;
    const m = readCopy(main, k, plainOk);
    const b = readCopy(back, k, plainOk);
    const read = m.kind === "ok" ? m : b;
    if (read.kind !== "ok") return refuse(m.kind === "unreadable" ? m.why : b.kind === "unreadable" ? b.why : "it has no store");
    if (m.kind !== "ok" && back) writePrivate(file, back, platform);
    if (!read.sealed && found.kind === "none") {
      const made = await create(key);
      if (made.kind === "failed") noKeychain = made.why;
      else if (made.kind === "key") {
        const kept = await lookup(key);
        if (kept.kind === "key" && kept.key.equals(made.key)) k = made.key;
        else {
          await dropMade(key);
          noKeychain = "it didn't keep the store key Channels just made";
        }
      }
    }
    if (k && !read.sealed) saver(k)(JSON.stringify(read.json));
    if (k) await markFinished(key);
    return open(read.json, null, k, noKeychain);
  } catch (e) {
    return refuse(reason(e));
  }
}
