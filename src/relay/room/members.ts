import * as Effect from "effect/Effect";
import type { GoneHow } from "@kiwi/core/protocol.ts";
import { verify } from "@kiwi/core/identity.ts";
import { BadRequest, Conflict, NotFound, TooLarge, TooMany } from "../failures.ts";
import { Policy } from "../policy.ts";
import { fits, MAX_RECORD, MAX_WRAPPED, MemberRecord } from "../schema.ts";
import { readMeta } from "./auth.ts";
import { RoomStore } from "./db.ts";
import { rotateDelegations } from "./delegations.ts";

export function memberFits(m: MemberBody, epoch: number): boolean {
  return fits(MemberRecord, m) && !Object.keys(m.keys ?? {}).some((e) => !/^\d{1,9}$/.test(e) || Number(e) > epoch);
}

export const putMember = Effect.fn("Room.putMember")(function* (m: MemberBody, epoch: number, delegation: string | null = null) {
  const db = yield* RoomStore;
  if (!memberFits(m, epoch)) return yield* new BadRequest({ message: "bad member" });
  db.migrate();
  db.sql.run(
    "INSERT INTO members (pk, xpk, rec, rec_e, since, active, read_only, delegation) VALUES (?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT (pk) DO UPDATE SET xpk = excluded.xpk, rec = excluded.rec, rec_e = excluded.rec_e, active = 1, read_only = excluded.read_only, delegation = excluded.delegation",
    m.pk,
    m.xpk,
    m.rec,
    epoch,
    Date.now(),
    m.post === false ? 1 : 0,
    delegation,
  );
  db.membersChanged(m.pk);
  for (const [e, wrapped] of Object.entries(m.keys ?? {})) {
    db.sql.run("INSERT OR REPLACE INTO keys (pk, e, wrapped) VALUES (?, ?, ?)", m.pk, Number(e), wrapped);
  }
});

export const approve = Effect.fn("Room.approve")(function* (body: MemberBody & { request?: string }, delegation: string | null = null) {
  const db = yield* RoomStore;
  const policy = yield* Policy;
  const { epoch } = yield* readMeta;
  if (body && Object.hasOwn(body, "replaces")) return yield* new BadRequest({ message: "bad member" });
  const most = policy.membersPerChannel;
  if (most && !db.isMember(body.pk) && db.activeMembers() >= most) {
    return yield* new TooMany({ message: `this channel has ${most} members, the most this relay allows; remove someone to let another in` });
  }
  for (let e = 0; e <= epoch; e++) {
    if (!body.keys?.[String(e)]) return yield* new BadRequest({ message: `missing wrapped key for epoch ${e}` });
  }
  yield* putMember(body, epoch, delegation);
  db.changed("roster");
  if (body.request) db.sql.run("UPDATE requests SET status = 'approved', received = ? WHERE id = ? AND pk = ?", Date.now(), body.request, body.pk);
});

export const keysFor = Effect.fn("Room.keysFor")(function* (pk: string) {
  const db = yield* RoomStore;
  db.migrate();
  const rows = db.sql.all<{ e: number; wrapped: string }>("SELECT e, wrapped FROM keys WHERE pk = ?", pk);
  const delegation = db.sql.all<{ d: string | null }>("SELECT delegation AS d FROM members WHERE pk = ?", pk)[0]?.d;
  return {
    epoch: (yield* readMeta).epoch,
    keys: Object.fromEntries(rows.map((r) => [String(r.e), r.wrapped])) as Record<string, string>,
    ...(delegation ? { delegation } : {}),
  };
});

export const setRecord = Effect.fn("Room.setRecord")(function* (pk: string, rec: string, e: number, post: boolean) {
  const db = yield* RoomStore;
  if (pk === (yield* readMeta).ownerPk) return yield* new BadRequest({ message: "the owner's record isn't changed this way" });
  if (!db.isMember(pk)) return yield* new NotFound({ message: "not a member" });
  if (!Number.isInteger(e) || e < 0 || e > (yield* readMeta).epoch) return yield* new BadRequest({ message: "no such epoch" });
  if (rec.length > MAX_RECORD) return yield* new TooLarge({ message: "record too large" });
  db.migrate();
  db.sql.run("UPDATE members SET rec = ?, rec_e = ?, read_only = ?, admitted_by = NULL WHERE pk = ?", rec, e, post ? 0 : 1, pk);
  db.membersChanged(pk);
  db.changed("roster");
});

export const setCanPost = Effect.fn("Room.setCanPost")(function* (pk: string, post: boolean) {
  const db = yield* RoomStore;
  if (pk === (yield* readMeta).ownerPk) return yield* new BadRequest({ message: "the owner may always post" });
  if (!db.isMember(pk)) return yield* new NotFound({ message: "not a member" });
  db.migrate();
  db.sql.run("UPDATE members SET read_only = ?, admitted_by = NULL WHERE pk = ?", post ? 0 : 1, pk);
  db.membersChanged(pk);
  db.changed("roster");
});

export const remove = Effect.fn("Room.remove")(function* (pk: string, how: GoneHow) {
  const db = yield* RoomStore;
  const { ownerPk } = yield* readMeta;
  if (pk === ownerPk) return yield* new BadRequest({ message: "the owner can't leave; close the channel instead" });
  if (!db.isMember(pk)) return yield* new NotFound({ message: "not a member" });
  db.migrate();
  db.sql.run("UPDATE members SET active = 0, gone = ? WHERE pk = ?", how, pk);
  db.sql.run("DELETE FROM keys WHERE pk = ?", pk);
  db.sql.run("DELETE FROM requests WHERE pk = ?", pk);
  db.sql.run("DELETE FROM reads WHERE pk = ?", pk);
  db.membersChanged(pk);
  db.changed("roster");
  db.set("rotate", 1);
  db.changed("info");
});

export const rotate = Effect.fn("Room.rotate")(function* (
  epoch: number,
  keys: Record<string, string>,
  owner?: { pk: string; xpk: string; sig: string },
  older?: Record<string, Record<string, string>>,
) {
  const db = yield* RoomStore;
  const stated = yield* readMeta;
  if (owner) {
    const restated =
      owner.pk === stated.ownerPk && owner.xpk === stated.ownerXpk && (yield* Effect.promise(async () => verify({ room: db.roomId, pk: owner.pk, xpk: owner.xpk, v: 2, sig: owner.sig })));
    if (!restated) return yield* new BadRequest({ message: "bad owner statement" });
  }
  const meta = yield* readMeta;
  if (epoch !== meta.epoch + 1) return yield* new Conflict({ message: `next epoch is ${meta.epoch + 1}` });
  const members = db.members().filter((m) => m.active);
  for (const m of members) if (!keys[m.pk]) return yield* new BadRequest({ message: `missing wrapped key for ${m.pk.slice(0, 8)}` });
  for (const m of members) if (typeof keys[m.pk] !== "string" || keys[m.pk]!.length > MAX_WRAPPED) return yield* new BadRequest({ message: "bad wrapped key" });
  const known = new Set(members.map((m) => m.pk));
  for (const r of db.sql.all<{ pk: string }>("SELECT pk FROM delegations")) known.add(r.pk);
  const prior: { pk: string; e: number; box: string }[] = [];
  for (const [pk, boxes] of Object.entries(older ?? {})) {
    if (!known.has(pk) || !boxes || typeof boxes !== "object" || Array.isArray(boxes)) return yield* new BadRequest({ message: "bad wrapped key" });
    for (const [e, box] of Object.entries(boxes)) {
      if (!/^\d{1,9}$/.test(e) || Number(e) >= epoch || typeof box !== "string" || box.length > MAX_WRAPPED) return yield* new BadRequest({ message: "bad wrapped key" });
      prior.push({ pk, e: Number(e), box });
    }
  }
  for (const m of members) db.sql.run("INSERT OR REPLACE INTO keys (pk, e, wrapped) VALUES (?, ?, ?)", m.pk, epoch, keys[m.pk]!);
  for (const p of prior) db.sql.run("INSERT OR REPLACE INTO keys (pk, e, wrapped) VALUES (?, ?, ?)", p.pk, p.e, p.box);
  yield* rotateDelegations(epoch, keys);
  db.set("epoch", epoch);
  db.set("rotate", 0);
  if (owner) db.set("owner_sig", owner.sig);
  db.changed("info");
});

export interface MemberBody {
  pk: string;
  xpk: string;
  rec: string;
  keys?: Record<string, string>;
  post?: boolean;
}
