import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { CHECKPOINT_WINDOW_MS, nextOccurrence, wellFormedDaily, type CheckpointDaily, type Occurrence, type OccurrenceRecord } from "@kiwi/core/checkpoint-schedule.ts";
import type { ServerFrame } from "@kiwi/core/protocol.ts";
import { BadRequest, Taken } from "../failures.ts";
import { RoomStore, type RoomDb } from "./db.ts";
import type { Effects } from "./directory.ts";

const DAILY_KEY = "ckpt_daily";
const NEXT_KEY = "ckpt_next";
const LOG_KEY = "ckpt_log";
const CHECKPOINT_LOG_KEPT = 14;

const parsed = (raw: string | undefined): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // A row this relay can't read is treated as never written.
    return null;
  }
};

const dailyOf = (db: RoomDb): CheckpointDaily | null => {
  const d = parsed(db.get(DAILY_KEY));
  return wellFormedDaily(d) ? d : null;
};

const nextOf = (db: RoomDb): Occurrence | null => {
  const n = parsed(db.get(NEXT_KEY)) as Partial<Occurrence> | null;
  return n && typeof n.id === "string" && Number.isSafeInteger(n.due) ? { id: n.id, due: n.due! } : null;
};

const logOf = (db: RoomDb): OccurrenceRecord[] => {
  const l = parsed(db.get(LOG_KEY));
  return Array.isArray(l) ? (l as OccurrenceRecord[]) : [];
};

const keep = (db: RoomDb, log: readonly OccurrenceRecord[]): void => db.set(LOG_KEY, JSON.stringify(log.slice(-CHECKPOINT_LOG_KEPT)));

const settled = (log: readonly OccurrenceRecord[], now: number): OccurrenceRecord[] =>
  log.map((r) => (r.state === "open" && now >= r.due + CHECKPOINT_WINDOW_MS ? { id: r.id, due: r.due, state: "missed", why: "nobody answered" } : r));

const dueFrame = (r: { id: string; due: number }): string => JSON.stringify({ t: "checkpoint", occurrence: r.id, due: r.due } satisfies ServerFrame);

export const checkpointDeadline = (db: RoomDb): number | null => nextOf(db)?.due ?? null;

export const setCheckpointSchedule = Effect.fn("Room.setCheckpointSchedule")(function* (daily: unknown) {
  if (daily !== null && !wellFormedDaily(daily)) return yield* new BadRequest({ message: "a daily checkpoint time is HH:MM in a known IANA time zone, or null" });
  const db = yield* RoomStore;
  const now = yield* Clock.currentTimeMillis;
  const next = daily ? nextOccurrence(daily, now) : null;
  db.set("room", db.roomId);
  db.set(DAILY_KEY, JSON.stringify(daily));
  db.set(NEXT_KEY, JSON.stringify(next));
  return { checkpointAt: next?.due ?? null } satisfies Effects;
});

export const checkpointAlarm = (online: number): Effect.Effect<Effects, never, RoomStore> =>
  Effect.gen(function* () {
    const db = yield* RoomStore;
    const now = yield* Clock.currentTimeMillis;
    const daily = dailyOf(db);
    const next = nextOf(db);
    const log = settled(logOf(db), now);
    keep(db, log);
    if (!daily || !next) return { checkpointAt: null } satisfies Effects;
    if (now < next.due) return { checkpointAt: next.due } satisfies Effects;
    const late = now >= next.due + CHECKPOINT_WINDOW_MS;
    const record: OccurrenceRecord = late
      ? { id: next.id, due: next.due, state: "missed", why: "relay asleep" }
      : online === 0
        ? { id: next.id, due: next.due, state: "missed", why: "nobody online" }
        : { id: next.id, due: next.due, state: "open" };
    keep(db, [...log.filter((r) => r.id !== next.id), record]);
    const following = nextOccurrence(daily, Math.max(next.due, now));
    db.set(NEXT_KEY, JSON.stringify(following));
    return { ...(record.state === "open" ? { broadcast: [dueFrame(record)] } : {}), checkpointAt: following.due } satisfies Effects;
  });

export const openCheckpointFrames: Effect.Effect<string[], never, RoomStore> = Effect.gen(function* () {
  const db = yield* RoomStore;
  const now = yield* Clock.currentTimeMillis;
  return settled(logOf(db), now)
    .filter((r) => r.state === "open")
    .map(dueFrame);
});

export const claimOccurrence = Effect.fn("Room.claimOccurrence")(function* (id: unknown, sender: string, cid: unknown) {
  if (typeof id !== "string" || id.length > 32) return yield* new BadRequest({ message: "bad checkpoint occurrence" });
  const db = yield* RoomStore;
  const now = yield* Clock.currentTimeMillis;
  const record = settled(logOf(db), now).find((r) => r.id === id);
  if (record?.state === "open") return id;
  if (record?.state === "answered" && typeof cid === "string" && db.sentAs(record.seq, sender, cid)) return id;
  return yield* new Taken({ message: `the daily checkpoint request for ${id} was already made, or isn't due` });
});

export const answerOccurrence = (id: string, seq: number): Effect.Effect<void, never, RoomStore> =>
  Effect.map(RoomStore, (db) =>
    keep(
      db,
      logOf(db).map((r) => (r.id === id && r.state === "open" ? { id: r.id, due: r.due, state: "answered", seq } : r)),
    ),
  );

export const checkpointView = Effect.gen(function* () {
  const db = yield* RoomStore;
  const now = yield* Clock.currentTimeMillis;
  return { daily: dailyOf(db), next: nextOf(db), log: settled(logOf(db), now) };
});
