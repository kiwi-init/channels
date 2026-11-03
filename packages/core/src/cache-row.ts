import { received } from "./client/history.ts";
import { open, seal } from "./crypto.ts";
import { verify } from "./identity.ts";
import { asSent, wellFormed, type Envelope, type Message } from "./protocol.ts";

export interface CachedRow {
  seq: number;
  rts?: number;
  e: number;
  iv: string;
  ct: string;
}

export async function packRow(key: string, roomId: string, epoch: number, message: Message): Promise<CachedRow> {
  const { seq, rts, sigOk, opened, proven, sealed: room, ...payload } = asSent(message);
  void [sigOk, opened, proven];
  const sealed = await seal(key, roomId, { seq, msg: payload, ...(room ? { sealed: room } : {}) });
  return { seq, ...(rts !== undefined ? { rts } : {}), e: epoch, iv: sealed.iv, ct: sealed.ct };
}

export interface Unread {
  seq: number;
  unread: true;
}

export async function packEnvelope(key: string, roomId: string, epoch: number, env: Envelope): Promise<CachedRow> {
  const sealed = await seal(key, roomId, { seq: env.seq, raw: { ts: env.ts, e: env.e ?? 0, iv: env.iv, ct: env.ct } });
  return { seq: env.seq, rts: env.ts, e: epoch, iv: sealed.iv, ct: sealed.ct };
}

function wellFormedRaw(x: unknown): x is { ts: number; e: number; iv: string; ct: string } {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return Number.isFinite(r.ts) && Number.isSafeInteger(r.e) && typeof r.iv === "string" && typeof r.ct === "string";
}

async function reopen(seq: number, raw: { ts: number; e: number; iv: string; ct: string }, roomId: string, keys: Record<string, string>): Promise<Message | Unread> {
  const key = keys[String(raw.e)];
  const p = key ? ((await open(key, roomId, raw.iv, raw.ct).catch(() => null)) as unknown) : null;
  return wellFormed(p) ? received(p, seq, raw.ts, await verify(p)) : { seq, unread: true };
}

function sealedIn(x: unknown): x is { room: string; n: number } {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return typeof r.room === "string" && r.room.length > 0 && r.room.length <= 100 && Number.isSafeInteger(r.n) && (r.n as number) > 0;
}

export async function openRow(row: CachedRow, roomId: string, keys: Record<string, string>): Promise<Message | Unread | null> {
  const epochs = [String(row.e), ...Object.keys(keys).filter((e) => e !== String(row.e))];
  for (const e of epochs) {
    const key = keys[e];
    if (!key) continue;
    const opened = (await open(key, roomId, row.iv, row.ct)) as { seq?: unknown; msg?: unknown; raw?: unknown; sealed?: unknown } | null;
    if (!opened || opened.seq !== row.seq) continue;
    if (wellFormedRaw(opened.raw)) return reopen(row.seq, opened.raw, roomId, keys);
    if (!opened.msg || typeof opened.msg !== "object") continue;
    const msg = { ...(opened.msg as Record<string, unknown>) };
    const room = sealedIn(opened.sealed) ? opened.sealed : sealedIn(msg.sealed) ? msg.sealed : null;
    delete msg.opened;
    delete msg.proven;
    delete msg.sealed;
    if (!wellFormed(msg)) continue;
    const m = received(msg, row.seq, row.rts, await verify(msg));
    return room ? { ...m, room: room.room, sealed: room } : m;
  }
  return null;
}

function wellFormedRow(x: unknown): x is CachedRow {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return Number.isSafeInteger(r.seq) && Number.isSafeInteger(r.e) && typeof r.iv === "string" && typeof r.ct === "string" && (r.rts === undefined || typeof r.rts === "number");
}

export async function openRows(rows: readonly unknown[], roomId: string, keys: Record<string, string>): Promise<(Message | Unread | null)[]> {
  return Promise.all(rows.map((row) => (wellFormedRow(row) ? openRow(row, roomId, keys).catch(() => null) : Promise.resolve(null))));
}

const KEPT = 1;

export interface CachedKept {
  e: number;
  iv: string;
  ct: string;
}

export async function packKept(key: string, roomId: string, epoch: number, state: object): Promise<CachedKept> {
  const sealed = await seal(key, roomId, { kept: KEPT, state }, { pack: true });
  return { e: epoch, iv: sealed.iv, ct: sealed.ct };
}

function wellFormedKept(x: unknown): x is CachedKept {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return Number.isSafeInteger(r.e) && typeof r.iv === "string" && typeof r.ct === "string";
}

export async function openKept(sealed: unknown, roomId: string, keys: Record<string, string>): Promise<unknown> {
  if (!wellFormedKept(sealed)) return null;
  for (const e of [String(sealed.e), ...Object.keys(keys).filter((k) => k !== String(sealed.e))]) {
    const key = keys[e];
    if (!key) continue;
    const opened = (await open(key, roomId, sealed.iv, sealed.ct).catch(() => null)) as { kept?: unknown; state?: unknown } | null;
    if (opened && opened.kept === KEPT && opened.state && typeof opened.state === "object") return opened.state;
  }
  return null;
}
