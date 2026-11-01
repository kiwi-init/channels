import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { b64url } from "@kiwi/core/crypto.ts";
import { OPEN_POLICY, Policy } from "../src/relay/policy.ts";
import { RoomDb, RoomStore, type Sql, type SqlParam } from "../src/relay/room.ts";
import { append } from "../src/relay/room/messages.ts";

const IV = "aXZpdml2aXZpdml2";
const ct = (): string => b64url(crypto.getRandomValues(new Uint8Array(48)));

const sqlOf = (db: Database): Sql => ({
  run: (q, ...p) => void db.query(q).run(...p),
  all: <T>(q: string, ...p: SqlParam[]) => db.query(q).all(...p) as T[],
});

function room(): { mem: Database; db: RoomDb } {
  const mem = new Database(":memory:");
  const db = new RoomDb(sqlOf(mem), "c".repeat(32));
  db.init();
  db.set("owner_pk", "owner");
  db.set("owner_xpk", "owner-x");
  db.set("owner_sig", "sig");
  db.set("epoch", 0);
  return { mem, db };
}

const send = (db: RoomDb, bytes = OPEN_POLICY.bytesPerChannel) =>
  Effect.runPromise(
    append(IV, ct(), 0, "owner").pipe(Effect.provide(Layer.mergeAll(Layer.succeed(RoomStore, db), Layer.succeed(Policy, { ...OPEN_POLICY, bytesPerChannel: bytes, noRateLimits: true })))),
  );

test("a room past ten thousand messages keeps its first ones (T1390)", async () => {
  const { mem, db } = room();
  for (const seq of [1, 2, 3, 10_099]) db.insert(seq, 0, IV, ct(), 0);
  const out = await send(db);
  expect(out).toMatchObject({ seq: 10_100 });
  expect(db.since(0).map((m) => m.seq)).toEqual([1, 2, 3, 10_099, 10_100]);
  mem.close();
});

test("the channel's byte allowance is still the bound: the oldest make room (T1390)", async () => {
  const { mem, db } = room();
  for (let seq = 1; seq <= 4; seq++) db.insert(seq, 0, IV, ct(), 0);
  const each = db.storedBytes() / 4;
  await send(db, each * 4);
  expect(db.since(0).map((m) => m.seq)).toEqual([2, 3, 4, 5]);
  mem.close();
});
