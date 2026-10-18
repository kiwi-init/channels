import { received } from "./client/history.ts";
import { open, seal } from "./crypto.ts";
import { verify } from "./identity.ts";
import { wellFormed, type Envelope, type Message } from "./protocol.ts";

export interface CachedRow {
  seq: number;
  rts?: number;
  e: number;
  iv: string;
  ct: string;
}

export async function packRow(key: string, roomId: string, epoch: number, message: Message): Promise<CachedRow> {
  const { seq, rts, sigOk, ...payload } = message;
  void sigOk;
  const sealed = await seal(key, roomId, { seq, msg: payload });
  return { seq, ...(rts !== undefined ? { rts } : {}), e: epoch, iv: sealed.iv, ct: sealed.ct };
}

export interface Unread {
  seq: number;
  unread: true;
}

export async function packUnread(key: string, roomId: string, epoch: number, env: Envelope): Promise<CachedRow> {
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

export async function openRow(row: CachedRow, roomId: string, keys: Record<string, string>): Promise<Message | Unread | null> {
  const epochs = [String(row.e), ...Object.keys(keys).filter((e) => e !== String(row.e))];
  for (const e of epochs) {
    const key = keys[e];
    if (!key) continue;
    const opened = (await open(key, roomId, row.iv, row.ct)) as { seq?: unknown; msg?: unknown; raw?: unknown } | null;
    if (!opened || opened.seq !== row.seq) continue;
    if (wellFormedRaw(opened.raw)) return reopen(row.seq, opened.raw, roomId, keys);
    if (!wellFormed(opened.msg)) continue;
    return { ...opened.msg, seq: row.seq, ...(row.rts !== undefined ? { rts: row.rts } : {}), sigOk: await verify(opened.msg) };
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
