import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { wellFormedPush, wellFormedWake } from "@kiwi/core/push.ts";
import { BadRequest, TooMany } from "../failures.ts";
import { RoomStore, type RoomDb } from "./db.ts";
import type { Effects } from "./directory.ts";
import { allow, PUSH_PER_MINUTE } from "./limits.ts";

export function wakesFor(db: RoomDb, wake: unknown, sender: string, seq: number): Pick<Effects, "push"> {
  if (!wellFormedWake(wake)) return {};
  const wakes = db.pushFor(wake.filter((pk) => pk !== sender)).map((t) => ({ ...t, seq }));
  return wakes.length ? { push: { room: db.roomId, wakes } } : {};
}

export const registerPush = Effect.fn("Room.registerPush")(function* (me: string, body: unknown) {
  const db = yield* RoomStore;
  if (!allow(`push:${db.roomId}:${me}`, PUSH_PER_MINUTE)) return yield* new TooMany({ message: "too many push registrations; wait a minute" });
  if (!wellFormedPush(body)) return yield* new BadRequest({ message: "bad push registration" });
  db.setPush(me, body, yield* Clock.currentTimeMillis);
  return { ok: true };
});

export const unregisterPush = Effect.fn("Room.unregisterPush")(function* (me: string) {
  const db = yield* RoomStore;
  db.dropPush(me);
  return { ok: true };
});
