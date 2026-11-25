import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { wellFormedLiveBlob, wellFormedLiveTokens } from "@kiwi/core/live.ts";
import { BadRequest, TooMany } from "../failures.ts";
import type { LiveSend } from "../push.ts";
import { RoomStore, type RoomDb } from "./db.ts";
import type { Effects } from "./directory.ts";
import { allow, LIVE_PER_MINUTE, PUSH_PER_MINUTE } from "./limits.ts";

const LIVE_TTL_MS = 30 * 60_000;
const START_AGAIN_MS = 60 * 60_000;

function livePushes(db: RoomDb, sender: string, now: number): Pick<Effects, "live"> {
  const blobs = db.liveBlobs(now - LIVE_TTL_MS);
  const sends: LiveSend[] = [];
  for (const t of db.liveTargets()) {
    if (t.pk === sender) continue;
    const to = (token: string, event: LiveSend["event"]) => sends.push({ token, sandbox: t.sandbox, event, room: db.roomId, blobs });
    if (!blobs.length) {
      if (t.upd) to(t.upd, "end");
      if (t.upd || t.started !== null) db.liveEnded(t.pk);
    } else if (t.upd) to(t.upd, "update");
    else if (t.start && (t.started === null || now - t.started > START_AGAIN_MS)) {
      to(t.start, "start");
      db.liveStarted(t.pk, now);
    }
  }
  return sends.length ? { live: { room: db.roomId, sends } } : {};
}

const counted = (me: string, roomId: string) => allow(`live:${roomId}:${me}`, LIVE_PER_MINUTE);

export const putLive = Effect.fn("Room.putLive")(function* (me: string, body: unknown) {
  const db = yield* RoomStore;
  if (!counted(me, db.roomId)) return yield* new TooMany({ message: "too many live updates; slow down" });
  if (!wellFormedLiveBlob(body)) return yield* new BadRequest({ message: "bad live blob" });
  const now = yield* Clock.currentTimeMillis;
  db.setLive(me, body, now);
  return { data: { ok: true }, fx: livePushes(db, me, now) };
});

export const dropLive = Effect.fn("Room.dropLive")(function* (me: string) {
  const db = yield* RoomStore;
  if (!counted(me, db.roomId)) return yield* new TooMany({ message: "too many live updates; slow down" });
  const now = yield* Clock.currentTimeMillis;
  return { data: { ok: true }, fx: db.dropLive(me) ? livePushes(db, me, now) : {} };
});

export const registerLive = Effect.fn("Room.registerLive")(function* (me: string, body: unknown) {
  const db = yield* RoomStore;
  if (!allow(`live-token:${db.roomId}:${me}`, PUSH_PER_MINUTE)) return yield* new TooMany({ message: "too many live registrations; wait a minute" });
  if (!wellFormedLiveTokens(body)) return yield* new BadRequest({ message: "bad live registration" });
  db.setLiveTokens(me, body, yield* Clock.currentTimeMillis);
  return { ok: true };
});

export const unregisterLive = Effect.fn("Room.unregisterLive")(function* (me: string) {
  const db = yield* RoomStore;
  db.dropLiveTokens(me);
  return { ok: true };
});
