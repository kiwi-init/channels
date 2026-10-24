import { b64url, openBytes, sealBytes, type ChannelAccess } from "./crypto.ts";
import { canonical, sign, verify, type Identity } from "./identity.ts";
import { BASE_WIRE_VERSION, fromWire, toWire, wellFormedWire } from "./base-wire.ts";
import { MAX_SNAPSHOT_LENGTH, outgrown } from "./protocol.ts";
import type { FoldBase } from "./state.ts";

export interface SealedSnapshot {
  n: number;
  e: number;
  iv: string;
  ct: string;
  hash: string;
  sig: string;
}

const VERSION = BASE_WIRE_VERSION;
const MAX_PLAIN = 64 * 1024 * 1024;
const enc = new TextEncoder();

async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

const boundTo = (room: string, n: number, e: number) => `mc/snapshot\n${room}\n${n}\n${e}`;

async function statement(room: string, s: Omit<SealedSnapshot, "sig">) {
  return { what: "channel-snapshot", room, n: s.n, e: s.e, hash: s.hash, sealed: await digest(enc.encode(`${s.iv}.${s.ct}`)) };
}

async function squeeze(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream, cap: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > cap) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function wellFormedSnapshot(x: unknown): x is SealedSnapshot {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return (
    Number.isSafeInteger(s.n) &&
    (s.n as number) >= 1 &&
    Number.isSafeInteger(s.e) &&
    (s.e as number) >= 0 &&
    typeof s.iv === "string" &&
    typeof s.ct === "string" &&
    s.ct.length > 0 &&
    s.ct.length <= MAX_SNAPSHOT_LENGTH &&
    typeof s.hash === "string" &&
    typeof s.sig === "string"
  );
}

export async function sealSnapshot(owner: Identity, access: ChannelAccess, base: FoldBase): Promise<SealedSnapshot | null> {
  const e = access.epoch;
  const key = access.keys[String(e)];
  if (!key || owner.pk !== access.ownerPk || base.n < 1) return null;
  const plain = enc.encode(canonical({ v: VERSION, room: access.roomId, base: toWire(base) }));
  if (plain.length > MAX_PLAIN) return null;
  const hash = await digest(plain);
  const packed = await squeeze(plain, new CompressionStream("deflate-raw"), Infinity);
  if (!packed) return null;
  const { iv, ct } = await sealBytes(key, packed, boundTo(access.roomId, base.n, e));
  if (ct.length > MAX_SNAPSHOT_LENGTH) return null;
  const { sig } = await sign(owner, await statement(access.roomId, { n: base.n, e, iv, ct, hash }));
  return { n: base.n, e, iv, ct, hash, sig };
}

export async function openSnapshot(access: ChannelAccess, s: unknown): Promise<FoldBase | null> {
  if (!wellFormedSnapshot(s)) return null;
  const key = access.keys[String(s.e)];
  if (!key) return null;
  if (!(await verify({ ...(await statement(access.roomId, s)), pk: access.ownerPk, sig: s.sig }))) return null;
  const packed = await openBytes(key, s.iv, s.ct, boundTo(access.roomId, s.n, s.e));
  if (!packed) return null;
  const plain = await squeeze(packed, new DecompressionStream("deflate-raw"), MAX_PLAIN).catch(() => null);
  if (!plain || (await digest(plain)) !== s.hash) return null;
  try {
    const o = JSON.parse(new TextDecoder().decode(plain)) as { v?: unknown; room?: unknown; base?: unknown };
    const base = (o.v === 5 || o.v === VERSION) && o.room === access.roomId && wellFormedWire(o.base, s.n) ? fromWire(o.base) : null;
    return base && !outgrown(base) ? base : null;
  } catch {
    return null;
  }
}
