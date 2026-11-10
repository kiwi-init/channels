import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { blobId } from "@kiwi/core/crypto.ts";
import { MAX_BLOB_BYTES, MAX_CT_LENGTH, type Envelope, type ReadMark, type SlotTake } from "@kiwi/core/protocol.ts";
import { BadRequest, Conflict, Forbidden, ReadOnly, Taken, TooLarge, TooMany } from "../failures.ts";
import { Policy, upgradeFor, type RoomPolicy } from "../policy.ts";
import { fits, StoredEnvelope } from "../schema.ts";
import { readMeta } from "./auth.ts";
import { RoomStore, type RoomDb, type RoomServices } from "./db.ts";
import { LEASE_BATCH, type Lease, type LeaseAsk } from "../people.ts";
import { Directory, type Effects } from "./directory.ts";
import { formatBytes, untilUtcMidnight, utcDay } from "./limits.ts";

export const READ_ONLY = "the owner lets you only read in this channel";
const OWNER_BLOCKED = "this channel's owner is blocked on this relay, so nothing new can be posted here";
const LEASE_KEY = "person_lease";
const ASK_AGAIN_MS = 2_000;
const ASK_OVER_MS = 60_000;
const LOW = LEASE_BATCH / 4;

interface LeaseState {
  day: string;
  granted: number;
  over: boolean;
  blocked: boolean;
  limit: number | null;
  asked: number;
}

function personOverMessage(limit: number | null, ts: number, upgradeUrl: string | null): string {
  const upgrade = upgradeUrl ? `, or get more at ${upgradeUrl}` : "";
  return `this channel's owner has used today's ${limit ?? 0} messages; more can be sent after 00:00 UTC (in ${untilUtcMidnight(ts)})${upgrade}`;
}

const stateOf = (db: RoomDb, day: string): LeaseState => {
  const raw = db.get(LEASE_KEY);
  const s = raw ? (JSON.parse(raw) as LeaseState) : null;
  return s?.day === day && typeof s.granted === "number" ? s : { day, granted: 0, over: false, blocked: false, limit: null, asked: 0 };
};

const leftOf = (db: RoomDb, s: LeaseState, ts: number): number => s.granted - db.messagesOn(ts);

const quotaOwner = (db: RoomDb, policy: RoomPolicy): string | null => (policy.personMessagesPerDay ? (db.ownerUser() ?? null) : null);

const checkLease = (db: RoomDb, policy: RoomPolicy, day: string, ts: number) =>
  Effect.gen(function* () {
    const owner = quotaOwner(db, policy);
    if (!owner) return;
    const s = stateOf(db, day);
    if (s.blocked) return yield* new Forbidden({ message: OWNER_BLOCKED });
    const upgrade = upgradeFor(policy.upgradeUrl, owner);
    if (s.over || leftOf(db, s, ts) <= -LEASE_BATCH) return yield* new TooMany({ message: personOverMessage(s.limit ?? policy.personMessagesPerDay, ts, upgrade) });
  });

export const leaseWant: Effect.Effect<Effects, never, RoomServices> = Effect.gen(function* () {
  const db = yield* RoomStore;
  const policy = yield* Policy;
  const owner = quotaOwner(db, policy);
  const free = policy.personMessagesPerDay;
  if (!owner || !free) return {};
  const ts = yield* Clock.currentTimeMillis;
  const day = utcDay(ts);
  const s = stateOf(db, day);
  if (ts - s.asked < (s.over || s.blocked ? ASK_OVER_MS : ASK_AGAIN_MS)) return {};
  if (!s.over && !s.blocked && leftOf(db, s, ts) > LOW) return {};
  db.set(LEASE_KEY, JSON.stringify({ ...s, asked: ts }));
  const ask: LeaseAsk = { room: db.roomId, day, used: db.messagesOn(ts), free, paid: policy.paidMessagesPerDay, admin: policy.admins.includes(owner.toLowerCase()) };
  return { lease: { user: owner, ask } };
});

export const leaseTake = (got: Lease | null, day: string) =>
  Effect.gen(function* () {
    const db = yield* RoomStore;
    if (!got || !db.exists()) return;
    const s = stateOf(db, day);
    const granted = s.granted + got.grant;
    const over = granted - db.messagesOn(yield* Clock.currentTimeMillis) <= 0 && (got.grant === 0 || got.remaining === 0);
    db.set(LEASE_KEY, JSON.stringify({ ...s, granted, over, blocked: got.blocked, limit: got.limit, asked: over || got.blocked ? s.asked : 0 } satisfies LeaseState));
  });

export const leaseNow: Effect.Effect<void, never, RoomServices | Directory> = Effect.gen(function* () {
  const want = yield* leaseWant;
  if (!want.lease) return;
  const { user, ask } = want.lease;
  const people = yield* Directory;
  const got = yield* Effect.promise(() =>
    people.lease(user, ask).catch(() => {
      // The owner's store is out of reach: keep the channel going on its credit and ask again later.
      return null;
    }),
  );
  yield* leaseTake(got, ask.day);
});

const SEND_MEMORY_MS = 3_600_000;

interface Repeat {
  repeat: true;
  seq: number;
  ts: number;
}

export interface Slots {
  take?: SlotTake;
  free?: readonly string[];
}

export const append = Effect.fn("Room.append")(function* (iv: string, ct: string, e: number, sender: string, slots: Slots = {}, cid?: string) {
  const db = yield* RoomStore;
  const policy = yield* Policy;
  if (db.isReadOnly(sender)) return yield* new ReadOnly({ message: READ_ONLY });
  if (!fits(StoredEnvelope, { iv, ct })) return yield* new BadRequest({ message: "bad envelope" });
  if (ct.length > MAX_CT_LENGTH) return yield* new TooLarge({ message: "message too large" });
  const { epoch } = yield* readMeta;
  if (e !== epoch) return yield* new Conflict({ message: `stale key epoch ${e}; current is ${epoch}` });
  const ts = yield* Clock.currentTimeMillis;
  const held = slots.take ? db.slotHolder(slots.take.id, ts) : null;
  if (held && held.holder !== sender) return yield* new Taken({ message: `taken at #${held.seq}` });

  const day = utcDay(ts);
  const today = db.messagesOn(ts);
  const perDay = policy.messagesPerDay;
  if (perDay && today >= perDay) {
    return yield* new TooMany({ message: `this channel has stored ${perDay} messages today, its daily limit; more can be sent after 00:00 UTC (in ${untilUtcMidnight(ts)})` });
  }
  yield* checkLease(db, policy, day, ts);

  const cap = policy.bytesPerChannel;
  if (ct.length > cap) return yield* new TooLarge({ message: `that message is bigger than this channel may hold (${formatBytes(cap)})` });
  const seq = db.head() + 1;
  const store = (): Envelope | Repeat => {
    const prior = cid ? db.priorSend(sender, cid, ts - SEND_MEMORY_MS) : null;
    if (prior) return { repeat: true, seq: prior.seq, ts: prior.ts } satisfies Repeat;
    const was = db.storedBytes();
    let bytes = was;
    if (bytes + ct.length > cap) bytes -= db.dropOldest(bytes + ct.length - cap) + db.pruneBlobs();
    if (bytes + ct.length > cap) bytes -= db.dropOldestBlobs(bytes + ct.length - cap);
    if (bytes + ct.length > cap) bytes -= db.dropSnapshot();

    db.insert(seq, ts, iv, ct, e, cid ? { sender, cid, since: ts - SEND_MEMORY_MS } : undefined);
    if (slots.free?.length) db.freeSlots(slots.free, sender);
    if (slots.take) db.takeSlot(slots.take.id, sender, seq, ts + slots.take.ttl, ts);
    bytes += ct.length;
    if (bytes === was + ct.length) db.countMessage({ bytes, day, n: today + 1 });
    else db.setCounters({ bytes, day, n: today + 1 });
    return { seq, ts, iv, ct, e };
  };
  return store();
});

export const storeBlob = Effect.fn("Room.storeBlob")(function* (id: string, bytes: Uint8Array<ArrayBuffer>, sender: string) {
  const db = yield* RoomStore;
  const policy = yield* Policy;
  if (db.isReadOnly(sender)) return yield* new ReadOnly({ message: READ_ONLY });
  if (!bytes.length) return yield* new BadRequest({ message: "send the image's encrypted bytes" });
  if (bytes.length > MAX_BLOB_BYTES) return yield* new TooLarge({ message: "image too large" });
  if ((yield* Effect.promise(() => blobId(bytes))) !== id) return yield* new BadRequest({ message: "the image's bytes don't match its id" });
  if (db.hasBlob(id)) return;
  const cap = policy.bytesPerChannel;
  if (bytes.length > cap) return yield* new TooLarge({ message: `that image is bigger than this channel may hold (${formatBytes(cap)})` });
  const at = yield* Clock.currentTimeMillis;
  const head = db.head();
  let stored = db.storedBytes();
  if (stored + bytes.length > cap) stored -= db.dropOldest(stored + bytes.length - cap) + db.pruneBlobs();
  if (stored + bytes.length > cap) stored -= db.dropOldestBlobs(stored + bytes.length - cap);
  if (stored + bytes.length > cap) stored -= db.dropSnapshot();
  db.putBlob(id, bytes, at);
  const u = db.counters();
  db.setCounters({ bytes: stored + bytes.length, day: u?.day ?? "", n: u?.n ?? 0, head });
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
