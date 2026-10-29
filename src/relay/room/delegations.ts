import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { delegationLive, readDelegation, type Delegation } from "@kiwi/core/delegation.ts";
import { BadRequest, NotFound } from "../failures.ts";
import { MAX_WRAPPED } from "../schema.ts";
import { readMeta } from "./auth.ts";
import { RoomStore } from "./db.ts";

type Row = { pk: string; d: string; until: number; keys: string };

const wrappedKeys = (raw: string): Record<string, string> => JSON.parse(raw) as Record<string, string>;

export const putDelegation = Effect.fn("Room.putDelegation")(function* (body: { d?: unknown; keys?: unknown }) {
  const db = yield* RoomStore;
  const { ownerPk, epoch } = yield* readMeta;
  db.migrate();
  const d = yield* Effect.promise(() => readDelegation(body?.d, db.roomId, ownerPk));
  if (!d || !delegationLive(d, yield* Clock.currentTimeMillis)) return yield* new BadRequest({ message: "that isn't a live delegation from this channel's owner" });
  if (db.isMember(d.delegate)) return yield* new BadRequest({ message: "a member's key can't be a delegate" });
  const keys = body.keys;
  if (!keys || typeof keys !== "object" || Array.isArray(keys)) return yield* new BadRequest({ message: "send the channel's keys wrapped to the delegate" });
  const wrapped: Record<string, string> = {};
  for (let e = 0; e <= epoch; e++) {
    const w = (keys as Record<string, unknown>)[String(e)];
    if (typeof w !== "string" || w.length > MAX_WRAPPED) return yield* new BadRequest({ message: `missing wrapped key for epoch ${e}` });
    wrapped[String(e)] = w;
  }
  db.sql.run("INSERT OR REPLACE INTO delegations (pk, d, until, keys) VALUES (?, ?, ?, ?)", d.delegate, JSON.stringify(d), d.until, JSON.stringify(wrapped));
  return d;
});

export const dropDelegation = Effect.fn("Room.dropDelegation")(function* (pk: string) {
  const db = yield* RoomStore;
  yield* readMeta;
  db.migrate();
  if (!db.sql.all("SELECT 1 FROM delegations WHERE pk = ?", pk).length) return yield* new NotFound({ message: "no such delegation" });
  db.sql.run("DELETE FROM delegations WHERE pk = ?", pk);
});

export const liveDelegation = Effect.fn("Room.liveDelegation")(function* (pk: string) {
  const db = yield* RoomStore;
  yield* readMeta;
  db.migrate();
  const now = yield* Clock.currentTimeMillis;
  const r = db.sql.all<Row>("SELECT pk, d, until, keys FROM delegations WHERE pk = ? AND until > ?", pk, now)[0];
  if (!r) return null;
  const d = JSON.parse(r.d) as Delegation;
  return delegationLive(d, now) ? { d: r.d, keys: wrappedKeys(r.keys) } : null;
});

export const listDelegations = Effect.fn("Room.listDelegations")(function* () {
  const db = yield* RoomStore;
  yield* readMeta;
  db.migrate();
  return db.sql.all<Row>("SELECT pk, d, until, keys FROM delegations ORDER BY pk").map((r) => ({ d: r.d, epochs: Object.keys(wrappedKeys(r.keys)).map(Number) }));
});

export const rotateDelegations = Effect.fn("Room.rotateDelegations")(function* (epoch: number, keys: Record<string, string>) {
  const db = yield* RoomStore;
  db.migrate();
  for (const r of db.sql.all<Row>("SELECT pk, d, until, keys FROM delegations")) {
    const w = keys[r.pk];
    if (typeof w !== "string" || w.length > MAX_WRAPPED) {
      db.sql.run("DELETE FROM delegations WHERE pk = ?", r.pk);
      continue;
    }
    db.sql.run("UPDATE delegations SET keys = ? WHERE pk = ?", JSON.stringify({ ...wrappedKeys(r.keys), [String(epoch)]: w }), r.pk);
  }
});
