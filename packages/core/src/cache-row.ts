import { open, seal } from "./crypto.ts";
import { verify } from "./identity.ts";
import { wellFormed, type Message } from "./protocol.ts";

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

export async function openRow(row: CachedRow, roomId: string, keys: Record<string, string>): Promise<Message | null> {
  const epochs = [String(row.e), ...Object.keys(keys).filter((e) => e !== String(row.e))];
  for (const e of epochs) {
    const key = keys[e];
    if (!key) continue;
    const opened = (await open(key, roomId, row.iv, row.ct)) as { seq?: unknown; msg?: unknown } | null;
    if (!opened || opened.seq !== row.seq || !wellFormed(opened.msg)) continue;
    return { ...opened.msg, seq: row.seq, ...(row.rts !== undefined ? { rts: row.rts } : {}), sigOk: await verify(opened.msg) };
  }
  return null;
}

function wellFormedRow(x: unknown): x is CachedRow {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return Number.isSafeInteger(r.seq) && Number.isSafeInteger(r.e) && typeof r.iv === "string" && typeof r.ct === "string" && (r.rts === undefined || typeof r.rts === "number");
}

export async function openRows(rows: readonly unknown[], roomId: string, keys: Record<string, string>): Promise<(Message | null)[]> {
  return Promise.all(rows.map((row) => (wellFormedRow(row) ? openRow(row, roomId, keys).catch(() => null) : Promise.resolve(null))));
}
