import { b64url, fromB64url, newChannelKey, open, openFrom, seal, sealTo } from "./crypto.ts";

export const MAX_ROOM_MEMBERS = 200;
export const MAX_ROOM_SEALS = 200;

export interface RoomMember {
  name: string;
  pk: string;
}

export interface RoomMeta {
  name: string;
  members: RoomMember[];
  prev?: string;
}

export interface RoomSeal {
  id: string;
  n: number;
  keys: string[];
  meta: { iv: string; ct: string };
  proof?: string;
}

export interface RoomLetter {
  room: string;
  n: number;
  iv: string;
  ct: string;
}

export interface RoomNow {
  n: number;
  key?: string;
  meta?: RoomMeta;
}

export interface RoomStep {
  now: RoomNow;
  proven?: boolean;
}

const enc = new TextEncoder();
const boxInfo = (channel: string, id: string, n: number): string => `mc/room/${channel}/${id}/${n}`;
const bound = (channel: string, id: string, n: number): string => `${channel}/room/${id}/${n}`;

export const newRoomKey = (): string => newChannelKey();

const digest = (channel: string, s: Omit<RoomSeal, "proof">): Uint8Array<ArrayBuffer> =>
  new Uint8Array(enc.encode(JSON.stringify(["kiwi-room-seal", channel, s.id, s.n, [...s.keys].sort(), s.meta.iv, s.meta.ct])));

async function hmac(key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromB64url(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function proven(channel: string, s: RoomSeal, key: string): Promise<boolean> {
  if (!s.proof) return false;
  try {
    return await crypto.subtle.verify("HMAC", await hmac(key), fromB64url(s.proof), digest(channel, s));
  } catch {
    // A proof that isn't base64url, or a key that isn't one, proves nothing.
    return false;
  }
}

export async function sealRoom(channel: string, id: string, n: number, key: string, meta: RoomMeta, xpks: readonly string[], replaces?: string): Promise<RoomSeal> {
  const keys = (await Promise.all(xpks.map((xpk) => sealTo(xpk, key, boxInfo(channel, id, n))))).sort();
  const sealed = { id, n, keys, meta: await seal(key, bound(channel, id, n), replaces && replaces !== key ? { ...meta, prev: replaces } : meta) };
  if (!replaces) return sealed;
  const proof = b64url(new Uint8Array(await crypto.subtle.sign("HMAC", await hmac(replaces), digest(channel, sealed))));
  return { ...sealed, proof };
}

export async function openRoomKey(channel: string, s: Pick<RoomSeal, "id" | "n" | "keys">, xsk: string): Promise<string | null> {
  for (const box of s.keys) {
    const key = await openFrom(xsk, box, boxInfo(channel, s.id, s.n));
    if (key) return key;
  }
  return null;
}

export async function openRoomMeta(channel: string, s: Pick<RoomSeal, "id" | "n" | "meta">, key: string): Promise<RoomMeta | null> {
  return readMeta(await open(key, bound(channel, s.id, s.n), s.meta.iv, s.meta.ct));
}

async function anchored(channel: string, seals: readonly RoomSeal[], at: number, key: string, meta: RoomMeta): Promise<boolean> {
  let next = seals[at]!;
  let k = key;
  let m = meta;
  for (let i = at; ;) {
    if (i === 0) return next.n === 1 && !next.proof;
    let found = -1;
    for (let j = i - 1; j >= 0 && found < 0; j--) {
      const p = seals[j]!;
      const pk = p.n === next.n ? k : p.n === next.n - 1 ? m.prev : undefined;
      if (!pk || !(await proven(channel, next, pk))) continue;
      const pm = await openRoomMeta(channel, p, pk);
      if (!pm) continue;
      [found, next, k, m] = [j, p, pk, pm];
    }
    if (found < 0) return false;
    i = found;
  }
}

export async function stepRoom(channel: string, now: RoomNow | undefined, seals: readonly RoomSeal[], xsk: string | undefined): Promise<RoomStep | null> {
  const s = seals.at(-1)!;
  if (now?.key) {
    if (!(await proven(channel, s, now.key))) return null;
    if (s.n === now.n) {
      const meta = await openRoomMeta(channel, s, now.key);
      return meta ? { now: { ...now, meta }, proven: true } : null;
    }
    if (s.n !== now.n + 1) return null;
    const key = xsk ? await openRoomKey(channel, s, xsk) : null;
    if (!key) return { now: { n: s.n }, proven: true };
    const meta = await openRoomMeta(channel, s, key);
    return meta && meta.prev === now.key ? { now: { n: s.n, key, meta }, proven: true } : null;
  }
  const key = xsk ? await openRoomKey(channel, s, xsk) : null;
  if (!key) return { now: { n: s.n } };
  const meta = await openRoomMeta(channel, s, key);
  if (!meta || !(await anchored(channel, seals, seals.length - 1, key, meta))) return null;
  return { now: { n: s.n, key, meta }, proven: true };
}

export async function sealLetter(channel: string, room: string, n: number, key: string, inner: object): Promise<RoomLetter> {
  return { room, n, ...(await seal(key, bound(channel, room, n), inner)) };
}

export async function openLetter(channel: string, letter: RoomLetter, key: string): Promise<unknown> {
  return open(key, bound(channel, letter.room, letter.n), letter.iv, letter.ct);
}

const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

function readMeta(x: unknown): RoomMeta | null {
  if (!x || typeof x !== "object") return null;
  const m = x as { name?: unknown; members?: unknown; prev?: unknown };
  if (!text(m.name, 80) || !Array.isArray(m.members) || m.members.length === 0 || m.members.length > MAX_ROOM_MEMBERS) return null;
  if (m.prev !== undefined && !text(m.prev, 100)) return null;
  const members: RoomMember[] = [];
  for (const r of m.members) {
    const e = r as { name?: unknown; pk?: unknown } | null;
    if (!e || !text(e.name, 64) || !text(e.pk, 64)) return null;
    members.push({ name: e.name, pk: e.pk });
  }
  return { name: m.name, members, ...(m.prev ? { prev: m.prev } : {}) };
}

export const inRoom = (meta: Pick<RoomMeta, "members">, name: string, pk: string | undefined): boolean => !!pk && meta.members.some((m) => m.name === name && m.pk === pk);

export const publicView = <M extends { sealed?: unknown; opened?: unknown; proven?: unknown }>(messages: readonly M[]): M[] =>
  messages.flatMap((m) => (m.sealed ? [] : m.opened || m.proven !== undefined ? [Object.fromEntries(Object.entries(m).filter(([k]) => k !== "opened" && k !== "proven")) as M] : [m]));
