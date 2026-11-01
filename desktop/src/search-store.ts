import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { fromB64url } from "@kiwi/core/crypto.ts";
import type { FoldBase } from "@kiwi/core/state.ts";

import { sameRules, stampFor, type Fed } from "./search-feed.ts";
import { SearchIndex } from "./search-index.ts";

const MAGIC = Uint8Array.of(0x6b, 0x73, 0x69, 0x01);
const IV = 12;

export interface Loaded {
  index: SearchIndex;
  fed: Fed;
}

const ad = (roomId: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(`kiwi-search-index:${roomId}`);

const aes = (key: string): Promise<CryptoKey> => crypto.subtle.importKey("raw", fromB64url(key), "AES-GCM", false, ["encrypt", "decrypt"]);

export async function sealIndex(index: SearchIndex, fed: Fed, key: string, roomId: string): Promise<Uint8Array<ArrayBuffer>> {
  index.setStamp(stampFor(fed.through));
  index.set("base", JSON.stringify(fed.base));
  const iv = crypto.getRandomValues(new Uint8Array(IV));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: ad(roomId) }, await aes(key), index.bytes()));
  const out = new Uint8Array(MAGIC.length + IV + ct.length);
  out.set(MAGIC, 0);
  out.set(iv, MAGIC.length);
  out.set(ct, MAGIC.length + IV);
  return out;
}

export async function openIndex(sealed: Uint8Array, key: string, roomId: string): Promise<Loaded | null> {
  if (sealed.length <= MAGIC.length + IV || MAGIC.some((b, i) => sealed[i] !== b)) return null;
  const iv = sealed.slice(MAGIC.length, MAGIC.length + IV);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: ad(roomId) }, await aes(key), sealed.slice(MAGIC.length + IV)).then(
    (b) => new Uint8Array(b),
    () => null,
  );
  const index = plain ? SearchIndex.from(plain) : null;
  if (!index) return null;
  const stamp = index.stamp();
  if (!sameRules(stamp)) {
    index.close();
    return null;
  }
  const base = JSON.parse(index.get("base") ?? "null") as FoldBase | null;
  return { index, fed: { base, through: stamp?.through ?? 0 } };
}

export async function readIndexFile(file: string, key: string, roomId: string): Promise<Loaded | null> {
  const sealed = await readFile(file).catch(() => null);
  return sealed ? openIndex(new Uint8Array(sealed), key, roomId) : null;
}

export async function writeIndexFile(file: string, index: SearchIndex, fed: Fed, key: string, roomId: string): Promise<void> {
  const sealed = await sealIndex(index, fed, key, roomId);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, sealed, { mode: 0o600 });
  await rename(tmp, file);
}

export const removeIndexFile = (file: string): Promise<void> => rm(file, { force: true });
