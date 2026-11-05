import { createCipheriv, createDecipheriv } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { fromB64url } from "@kiwi/core/crypto.ts";
import type { FoldBase } from "@kiwi/core/state.ts";

import { sameRules, stampFor, type Fed } from "./search-feed.ts";
import { SearchIndex } from "./search-index.ts";

const MAGIC = Uint8Array.of(0x6b, 0x73, 0x69, 0x01);
const IV = 12;
const TAG = 16;
const CHUNK = 1 << 20;
const CIPHER = "aes-256-gcm";

export interface Loaded {
  index: SearchIndex;
  fed: Fed;
}

const ad = (roomId: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(`kiwi-search-index:${roomId}`);

function* sealed(index: SearchIndex, fed: Fed, key: string, roomId: string): Generator<Uint8Array> {
  index.setStamp(stampFor(fed));
  index.set("base", JSON.stringify(fed.base));
  const plain = index.bytes();
  const iv = crypto.getRandomValues(new Uint8Array(IV));
  const cipher = createCipheriv(CIPHER, fromB64url(key), iv).setAAD(ad(roomId));
  const head = new Uint8Array(MAGIC.length + IV);
  head.set(MAGIC, 0);
  head.set(iv, MAGIC.length);
  yield head;
  for (let at = 0; at < plain.length; at += CHUNK) yield cipher.update(plain.subarray(at, at + CHUNK));
  yield cipher.final();
  yield cipher.getAuthTag();
}

export async function sealIndex(index: SearchIndex, fed: Fed, key: string, roomId: string): Promise<Uint8Array<ArrayBuffer>> {
  const parts = [...sealed(index, fed, key, roomId)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export async function openIndex(file: Uint8Array, key: string, roomId: string): Promise<Loaded | null> {
  if (file.length < MAGIC.length + IV + TAG || MAGIC.some((b, i) => file[i] !== b)) return null;
  const body = file.subarray(MAGIC.length + IV, file.length - TAG);
  const plain = new Uint8Array(body.length);
  try {
    const decipher = createDecipheriv(CIPHER, fromB64url(key), file.subarray(MAGIC.length, MAGIC.length + IV))
      .setAAD(ad(roomId))
      .setAuthTag(file.subarray(file.length - TAG));
    let to = 0;
    for (let at = 0; at < body.length; at += CHUNK) {
      const part = decipher.update(body.subarray(at, at + CHUNK));
      plain.set(part, to);
      to += part.length;
    }
    plain.set(decipher.final(), to);
  } catch {
    // Another key, another room or a damaged file: the index is rebuilt from the archive instead.
    return null;
  }
  const index = SearchIndex.from(plain);
  if (!index) return null;
  const stamp = index.stamp();
  if (!stamp || !sameRules(stamp)) {
    index.close();
    return null;
  }
  const base = JSON.parse(index.get("base") ?? "null") as FoldBase | null;
  return { index, fed: { base, from: stamp.from, through: stamp.through } };
}

export async function readIndexFile(file: string, key: string, roomId: string): Promise<Loaded | null> {
  const bytes = await readFile(file).catch(() => null);
  return bytes ? openIndex(bytes, key, roomId) : null;
}

export async function writeIndexFile(file: string, index: SearchIndex, fed: Fed, key: string, roomId: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const out = await open(tmp, "w", 0o600);
  try {
    for (const part of sealed(index, fed, key, roomId)) {
      for (let at = 0; at < part.length;) at += (await out.write(part, at)).bytesWritten;
    }
  } finally {
    await out.close();
  }
  await rename(tmp, file);
}

export const removeIndexFile = (file: string): Promise<void> => rm(file, { force: true });
