import { b64url, fromB64url, newChannelKey, open, openFrom, seal, sealTo } from "./crypto.ts";
import { MAX_ROOM_MEMBERS, type RoomLetter, type RoomMember, type RoomMeta, type RoomNow, type RoomSeal } from "./room-rules.ts";
import type { Message } from "./protocol.ts";
import type { FoldBase, SecretRoom } from "./state/types.ts";

export type { RoomMeta, RoomSeal } from "./room-rules.ts";

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

export async function renameRoom(channel: string, last: RoomSeal, key: string, meta: RoomMeta): Promise<RoomSeal> {
  const sealed = { id: last.id, n: last.n, keys: last.keys, meta: await seal(key, bound(channel, last.id, last.n), meta) };
  const proof = b64url(new Uint8Array(await crypto.subtle.sign("HMAC", await hmac(key), digest(channel, sealed))));
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
  const m = x as { name?: unknown; members?: unknown; prev?: unknown; dm?: unknown };
  const dm = m.dm === true;
  if (dm ? m.name !== "" : !text(m.name, 80)) return null;
  if (!Array.isArray(m.members) || m.members.length === 0 || m.members.length > MAX_ROOM_MEMBERS) return null;
  if (m.prev !== undefined && !text(m.prev, 100)) return null;
  const members: RoomMember[] = [];
  for (const r of m.members) {
    const e = r as { name?: unknown; pk?: unknown } | null;
    if (!e || !text(e.name, 64) || !text(e.pk, 64)) return null;
    members.push({ name: e.name, pk: e.pk });
  }
  return { name: dm ? "" : (m.name as string), members, ...(m.prev ? { prev: m.prev } : {}), ...(dm ? { dm: true as const } : {}) };
}

export interface RoomCache {
  readonly roomId: string;
  readonly identity: { xsk?: string };
  readonly roomKeys: Map<string, string>;
  readonly roomNow: Map<string, RoomNow>;
  readonly roomSeals: Map<string, { seq: number; seal: RoomSeal }[]>;
  readonly sealSteps: Map<number, { proven?: boolean; opened?: RoomMeta }>;
}

async function replay(c: RoomCache, id: string): Promise<RoomNow | undefined> {
  const accepted: RoomSeal[] = [];
  let now: RoomNow | undefined;
  for (const { seq, seal } of c.roomSeals.get(id) ?? []) {
    const step = await stepRoom(c.roomId, now, [...accepted, seal], c.identity.xsk);
    if (!step) {
      c.sealSteps.set(seq, { proven: false });
      continue;
    }
    accepted.push(seal);
    now = step.now;
    if (now.key) c.roomKeys.set(`${id}/${now.n}`, now.key);
    c.sealSteps.set(seq, { ...(step.proven !== undefined ? { proven: step.proven } : {}), ...(step.proven && now.meta ? { opened: now.meta } : {}) });
  }
  if (now) c.roomNow.set(id, now);
  return now;
}

export async function settleSeal(c: RoomCache, m: Message): Promise<Message> {
  const ev = m.ev;
  if (ev?.op !== "room.seal") return m;
  if (!c.sealSteps.has(m.seq)) {
    const seal = { id: ev.id, n: ev.n, keys: ev.keys, meta: ev.meta, ...(ev.proof ? { proof: ev.proof } : {}) };
    const list = [...(c.roomSeals.get(ev.id) ?? []).filter((x) => x.seq !== m.seq), { seq: m.seq, seal }].sort((a, b) => a.seq - b.seq);
    c.roomSeals.set(
      ev.id,
      keptSeals(list, (x) => x.seal.n),
    );
    await replay(c, ev.id);
  }
  const step = c.sealSteps.get(m.seq) ?? {};
  return { ...m, ...(step.proven !== undefined ? { proven: step.proven } : {}), ...(step.opened ? { opened: step.opened } : {}) };
}

export async function openBaseRooms(c: RoomCache, base: FoldBase): Promise<FoldBase> {
  const secret: [string, SecretRoom][] = [];
  const rooms = new Map(base.rooms.map((r) => [r.id, r]));
  for (const [id, room] of base.secret ?? []) {
    const had = c.roomSeals.get(id) ?? [];
    c.roomSeals.set(id, [...room.seals.map((seal, i) => ({ seq: -(room.seals.length - i), seal })), ...had.filter((x) => x.seq > 0)]);
    const now = await replay(c, id);
    secret.push([id, { n: now?.n ?? room.n, seals: room.seals, ...(now?.meta ? { meta: now.meta } : {}) }]);
    if (now?.meta) rooms.set(id, { ...(rooms.get(id) ?? { id, createdBy: null, at: 0 }), name: now.meta.name, members: now.meta.members, ...(now.meta.dm ? { dm: true as const } : {}) });
    else if (room.meta) rooms.delete(id);
  }
  return { ...base, secret, rooms: [...rooms.values()] };
}

export function ownSeal(c: Omit<RoomCache, "roomId" | "identity">, id: string, seq: number, seal: RoomSeal, now: Required<RoomNow>): void {
  const list = [...(c.roomSeals.get(id) ?? []).filter((x) => x.seq !== seq), { seq, seal }].sort((a, b) => a.seq - b.seq);
  c.roomSeals.set(
    id,
    keptSeals(list, (x) => x.seal.n),
  );
  c.roomKeys.set(`${id}/${now.n}`, now.key);
  c.sealSteps.set(seq, { proven: true, opened: now.meta });
  if (list.at(-1)?.seq === seq) c.roomNow.set(id, now);
}

export const SEALS_PER_KEY = 8;

export function keptSeals<T>(list: readonly T[], n: (x: T) => number): T[] {
  const at = new Map<number, number[]>();
  list.forEach((x, i) => at.set(n(x), [...(at.get(n(x)) ?? []), i]));
  const keep = new Set<number>([0]);
  for (const ids of at.values()) for (const i of [...ids.slice(0, SEALS_PER_KEY), ...ids.slice(-SEALS_PER_KEY)]) keep.add(i);
  return list.filter((_, i) => keep.has(i));
}
