import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { MAX_CT_LENGTH, ROOM_RETENTION, type Envelope, type ReadMark } from "../../protocol.ts";
import { BadRequest, Conflict, ReadOnly, TooLarge, TooMany } from "../failures.ts";
import { Policy } from "../policy.ts";
import { fits, StoredEnvelope } from "../schema.ts";
import { readMeta } from "./auth.ts";
import { RoomStore, type RoomServices } from "./db.ts";
import type { Effects } from "./directory.ts";
import { formatBytes, untilUtcMidnight, utcDay } from "./limits.ts";

const READ_ONLY = "the owner lets you only read in this channel";

export const append = Effect.fn("Room.append")(function* (iv: string, ct: string, e: number, sender: string) {
  const db = yield* RoomStore;
  const policy = yield* Policy;
  if (db.isReadOnly(sender)) return yield* new ReadOnly({ message: READ_ONLY });
  if (!fits(StoredEnvelope, { iv, ct })) return yield* new BadRequest({ message: "bad envelope" });
  if (ct.length > MAX_CT_LENGTH) return yield* new TooLarge({ message: "message too large" });
  const { epoch } = yield* readMeta;
  if (e !== epoch) return yield* new Conflict({ message: `stale key epoch ${e}; current is ${epoch}` });
  const ts = yield* Clock.currentTimeMillis;

  const day = utcDay(ts);
  const today = db.messagesOn(ts);
  const perDay = policy.messagesPerDay;
  if (perDay && today >= perDay) {
    return yield* new TooMany({ message: `this channel has stored ${perDay} messages today, its daily limit; more can be sent after 00:00 UTC (in ${untilUtcMidnight(ts)})` });
  }

  const cap = policy.bytesPerChannel;
  if (ct.length > cap) return yield* new TooLarge({ message: `that message is bigger than this channel may hold (${formatBytes(cap)})` });
  const seq = db.head() + 1;
  let bytes = db.storedBytes();
  if (bytes + ct.length > cap) bytes -= db.dropOldest(bytes + ct.length - cap);

  db.insert(seq, ts, iv, ct, e);
  bytes += ct.length;
  if (seq % 100 === 0) bytes -= db.dropThrough(seq - ROOM_RETENTION);
  db.setCounters({ bytes, day, n: today + 1, head: seq });
  const stored: Envelope = { seq, ts, iv, ct, e };
  return stored;
});

export const touch: Effect.Effect<number | null, never, RoomServices> = Effect.gen(function* () {
  const db = yield* RoomStore;
  const days = (yield* Policy).expireAfterDays;
  if (!days || !db.exists()) return null;
  const now = yield* Clock.currentTimeMillis;
  if (now - Number(db.get("active") ?? 0) < 3_600_000 && db.get("room")) return null;
  db.set("active", now);
  db.set("room", db.roomId);
  return now + days * 86_400_000;
});

export const idleExpired: Effect.Effect<boolean, never, RoomServices> = Effect.gen(function* () {
  const db = yield* RoomStore;
  const days = (yield* Policy).expireAfterDays;
  if (!days || !db.exists()) return false;
  const last = Number(db.get("active") ?? db.get("created") ?? 0);
  return (yield* Clock.currentTimeMillis) - last >= days * 86_400_000;
});

export const expire: Effect.Effect<Effects, never, RoomStore> = Effect.map(RoomStore, (db) => ({ directory: db.unlinkAll(), wipe: true }));

export const markRead = Effect.fn("Room.markRead")(function* (pk: string, seq: unknown) {
  const db = yield* RoomStore;
  if (!Number.isSafeInteger(seq) || (seq as number) < 1) return yield* new BadRequest({ message: "seq must be a positive whole number" });
  const upTo = Math.min(seq as number, db.head());
  if (upTo <= db.readThrough(pk)) return null;
  const at = yield* Clock.currentTimeMillis;
  db.setReadThrough(pk, upTo, at);
  return { pk, seq: upTo, at } satisfies ReadMark;
});
