import { newChannelKey, open, openFrom, seal, sealTo } from "./crypto.ts";

export const MAX_ROOM_MEMBERS = 200;

export interface RoomMember {
  name: string;
  pk: string;
}

export interface RoomMeta {
  name: string;
  members: RoomMember[];
}

export interface RoomSeal {
  id: string;
  n: number;
  keys: string[];
  meta: { iv: string; ct: string };
}

export interface RoomLetter {
  room: string;
  n: number;
  iv: string;
  ct: string;
}

const boxInfo = (channel: string, id: string, n: number): string => `mc/room/${channel}/${id}/${n}`;
const bound = (channel: string, id: string, n: number): string => `${channel}/room/${id}/${n}`;

export const newRoomKey = (): string => newChannelKey();

export async function sealRoom(channel: string, id: string, n: number, key: string, meta: RoomMeta, xpks: readonly string[]): Promise<RoomSeal> {
  const keys = await Promise.all(xpks.map((xpk) => sealTo(xpk, key, boxInfo(channel, id, n))));
  return { id, n, keys: keys.sort(), meta: await seal(key, bound(channel, id, n), meta) };
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

export async function sealLetter(channel: string, room: string, n: number, key: string, inner: object): Promise<RoomLetter> {
  return { room, n, ...(await seal(key, bound(channel, room, n), inner)) };
}

export async function openLetter(channel: string, letter: RoomLetter, key: string): Promise<unknown> {
  return open(key, bound(channel, letter.room, letter.n), letter.iv, letter.ct);
}

const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

function readMeta(x: unknown): RoomMeta | null {
  if (!x || typeof x !== "object") return null;
  const m = x as { name?: unknown; members?: unknown };
  if (!text(m.name, 80) || !Array.isArray(m.members) || m.members.length === 0 || m.members.length > MAX_ROOM_MEMBERS) return null;
  const members: RoomMember[] = [];
  for (const r of m.members) {
    const e = r as { name?: unknown; pk?: unknown } | null;
    if (!e || !text(e.name, 64) || !text(e.pk, 64)) return null;
    members.push({ name: e.name, pk: e.pk });
  }
  return { name: m.name, members };
}

export const inRoom = (meta: Pick<RoomMeta, "members">, name: string, pk: string | undefined): boolean => !!pk && meta.members.some((m) => m.name === name && m.pk === pk);

export const publicView = <M extends { sealed?: unknown; opened?: unknown }>(messages: readonly M[]): M[] =>
  messages.flatMap((m) => (m.sealed ? [] : m.opened ? [Object.fromEntries(Object.entries(m).filter(([k]) => k !== "opened")) as M] : [m]));
