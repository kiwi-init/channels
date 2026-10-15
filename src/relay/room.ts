// Room logic shared by the Cloudflare Durable Object and the self-hosted Bun
// relay. Both back a room with SQLite; each adapter supplies the SQL calls and
// applies the returned effects (fan-out, disconnects, wiping the room).
//
// Every channel is owner-gated:
//   - the owner creates the room and is its first member;
//   - anyone holding the join code may *ask* to join (a pending request);
//   - only the owner can approve, which enrolls the requester's key and hands
//     it the channel keys, wrapped so only that key can open them;
//   - every request and socket is signed by a member key; no shared secret
//     ever reaches the relay;
//   - leaving or being removed revokes access at once, and the owner rotates
//     the channel key so the departed key can't read anything newer;
//   - closing deletes the room outright: no tombstone, nothing to recover.
//
// The relay stores public keys, opaque sealed blobs and ciphertext. Member
// names, roles and every message stay end-to-end encrypted.
//
// On Effect: RoomDb is the room's tables and rows, nothing about who may do
// what. The rules are the Effects below, which run with:
//   - RoomStore: the room's RoomDb (the Durable Object's ctx.storage.sql, or a
//     bun:sqlite file);
//   - Policy: what this relay allows (policy.ts);
//   - Clock: Effect's own, for message times, the daily count and idle expiry.
// They refuse with the tagged failures in failures.ts.

import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { fits, JoinRequest, MAX_RECORD, MAX_WRAPPED, MemberRecord, SealedIcon, StoredEnvelope } from "./schema.ts";
import { verifyRequest } from "../auth.ts";
import { encodeJoinCode, ownerFingerprint } from "../crypto.ts";
import type { HumanAuth } from "./human.ts";
import { Policy } from "./policy.ts";
import { GONE_WORDS, type GoneHow } from "../protocol.ts";
import {
  BadRequest,
  ChannelGone,
  Conflict,
  Denied,
  isRefusal,
  NotFound,
  NotMember,
  ReadOnly,
  refusalResponse,
  Removed,
  TooLarge,
  TooMany,
  Unauthorized,
  UpdateRequired,
} from "./failures.ts";
import { verify, verifyText } from "../identity.ts";
import { commitTo, NONCE_RE, ownerNonceStatement } from "../sas.ts";
import {
  MAX_CT_LENGTH,
  MAX_EPH_LENGTH,
  PAGE_LIMIT,
  ROOM_RETENTION,
  WS_PROTOCOL,
  type ClientFrame,
  type Envelope,
  type ReadMark,
  type ServerFrame,
} from "../protocol.ts";

export interface Sql {
  run(query: string, ...params: (string | number | null)[]): void;
  all<T>(query: string, ...params: (string | number | null)[]): T[];
}

/** What an adapter must do after handling a request or frame. */
export interface Effects {
  /** Send to every socket. */
  broadcast?: string[];
  /** Send to every socket except the sender. */
  others?: string;
  /** Send to the sender only. */
  reply?: string;
  /** Disconnect every socket authenticated as this key. */
  disconnect?: { pk: string; how: GoneHow };
  /** Delete the room's storage, then disconnect everyone. */
  wipe?: boolean;
  /** Update signed-in people's channel lists (a null entry drops this channel from theirs). */
  directory?: DirectoryUpdate[];
  /** The room was active: if it stays idle until this time, it expires (adapters schedule the check). */
  expireAt?: number;
}

/**
 * One signed-in person's tie to a channel, for their channel list: they own
 * it, they're in it, and/or agents they vouched for are. The relay already
 * knows these links; names and messages stay sealed.
 */
export interface DirectoryEntry {
  room: string;
  code: string;
  owner: boolean;
  member: boolean;
  agents: number;
  at: number;
}

export interface DirectoryUpdate {
  user: string;
  room: string;
  entry: DirectoryEntry | null;
}

/**
 * Signed-in people's owned channels, as the adapter keeps them (an object per person, or people.sqlite).
 * `reserve` is the quota's one check: in a single step it counts the person's channels and, when there's
 * room, holds a slot for this one, so two creates at once can't both pass. The create's own directory
 * update replaces the hold; `release` drops it when the create fails.
 */
export class Directory extends Context.Service<
  Directory,
  {
    list(user: string): Promise<DirectoryEntry[]>;
    reserve(user: string, room: string, most: number): Promise<boolean>;
    release(user: string, room: string): Promise<void>;
  }
>()("kiwi/relay/Directory") {}

/** How long a create's hold on a quota slot lasts if the create never finishes (a crash). */
export const HOLD_MS = 10 * 60_000;

/** A hold, not a channel: what reserve writes before the create, with no join code yet. */
export const holdEntry = (room: string, now: number): DirectoryEntry => ({ room, code: "", owner: true, member: true, agents: 0, at: now });
const isHold = (e: DirectoryEntry) => e.code === "";

/**
 * The quota's decision, for the adapters to run in one step: may `room` take one of `most` slots, and
 * which stale holds (a create that died) to drop. A room that already has its entry is let through.
 */
export function reserveSlot(entries: DirectoryEntry[], room: string, most: number, now: number): { ok: boolean; stale: string[] } {
  const stale = entries.filter((e) => isHold(e) && e.room !== room && now - e.at > HOLD_MS).map((e) => e.room);
  const live = entries.filter((e) => e.owner && !stale.includes(e.room));
  return { ok: live.some((e) => e.room === room) || live.length < most, stale };
}

/** Whether an entry is a hold that `release` may drop (never a created channel's entry). */
export const releasable = (e: DirectoryEntry | undefined) => !!e && isHold(e);

const utcDay = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** "3h 12m": how long until the UTC date changes. */
function untilUtcMidnight(ts: number): string {
  const d = new Date(ts);
  const left = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - ts;
  const h = Math.floor(left / 3_600_000);
  const m = Math.ceil((left % 3_600_000) / 60_000);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function formatBytes(n: number): string {
  return n >= 1024 ** 3 ? `${+(n / 1024 ** 3).toFixed(1)} GB` : `${+(n / 1024 ** 2).toFixed(1)} MB`;
}

/** Messages one member may post per minute: plenty for real work, too few to flush a channel's history. */
export const MESSAGES_PER_MINUTE = 120;
/** Presence and other ephemeral frames one member may send per minute. */
const EPHEMERAL_PER_MINUTE = 60;
/** How many keys the limiter remembers. Past this, the oldest window is dropped, never the whole table. */
const MAX_WINDOWS = 10_000;
/** Each key's window, oldest start first: a key is moved to the end when its new window starts. */
const windows = new Map<string, { start: number; n: number }>();

/** A fixed one-minute window per key; false once the key has used up its limit. */
export function allow(key: string, limit: number, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start > 60_000) {
    windows.delete(key);
    windows.set(key, { start: now, n: 1 });
    // A flood of new keys drops the oldest windows (most already over), not every member's count.
    while (windows.size > MAX_WINDOWS) {
      const oldest = windows.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      windows.delete(oldest);
    }
    return true;
  }
  return ++w.n <= limit;
}

/** Most join requests a room holds at once; stops request spam. */
const MAX_PENDING = 20;

/** How far each member has read: the relay keeps a seq and a time per key, never what was read. */
const READS_TABLE = "CREATE TABLE reads (pk TEXT PRIMARY KEY, seq INTEGER NOT NULL, at INTEGER NOT NULL)";

/** Read marks one member may send per minute: an agent marks as it reads, a second apart at most. */
export const READS_PER_MINUTE = 60;
/** Pending requests expire after this long. */
const REQUEST_TTL_MS = 60 * 60_000;
/** What a member the owner lets only read is told when they post anyway. */
const READ_ONLY = "the owner lets you only read in this channel";

/**
 * Request columns added after the first rooms existed. The join check (see sas.ts): the joiner's
 * commit, the owner's signed nonce, the joiner's reveal. `sponsor_*` columns stay for rooms from
 * before 0.11 (the relay vouched for agents then); new rooms leave them empty and nobody reads them.
 */
const REQUEST_COLUMNS = [
  ["kind", "TEXT NOT NULL DEFAULT 'agent'"],
  ["sponsor_user", "TEXT"],
  ["sponsor_name", "TEXT"],
  ["received", "INTEGER"],
  ["sponsor_req", "TEXT"],
  // The join check (see sas.ts): the joiner's commit, the owner's signed nonce, the joiner's reveal.
  ["commit_to", "TEXT"],
  ["owner_nonce", "TEXT"],
  ["reveal", "TEXT"],
] as const;

/** A channel's stored bytes, and how many messages it stored on `day` (UTC). */
interface Counters {
  bytes: number;
  day: string;
  n: number;
}
/** What a client that speaks an old path is told. */
export const UPDATE_KIWI = "update kiwi to join or approve here: curl -fsSL https://channels.kiwiinit.com/install | sh (Windows: irm https://channels.kiwiinit.com/install.ps1 | iex)";

/**
 * GET /info and POST /requests with no `fp` are refused before the room is opened.
 * A room id is not a join code: only a client holding the code's fingerprint half
 * may learn the owner key or the owner's name, or ask to join (else anyone who saw
 * a room id could fill its pending requests). A present but wrong fingerprint falls
 * through and is answered like a missing room.
 */
export function missingFingerprint(method: string, path: string, url: URL): UpdateRequired | null {
  const m = method.toUpperCase();
  if (((m === "GET" && path === "/info") || (m === "POST" && path === "/requests")) && url.searchParams.get("fp") === null) {
    return new UpdateRequired({ message: UPDATE_KIWI });
  }
  return null;
}

export const frame = (f: ServerFrame) => JSON.stringify(f);

/** The signed token from the Authorization header or, for WebSockets, the subprotocol list. */
export function requestToken(req: Request): string {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const protos = (req.headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim());
  if (protos[0] === WS_PROTOCOL && protos[1]) return protos[1];
  return "";
}

/** Response headers that accept the Channels subprotocol, if the client offered it. */
export function wsHeaders(req: Request): Record<string, string> {
  return req.headers.get("sec-websocket-protocol")?.includes(WS_PROTOCOL) ? { "sec-websocket-protocol": WS_PROTOCOL } : {};
}

interface Meta {
  ownerPk: string;
  ownerXpk: string;
  ownerSig: string;
  epoch: number;
  rotate: boolean;
}

/** Storage handles whose room already has every column this version reads. */
const migrated = new WeakSet<Sql>();

/**
 * A room's tables and rows. Reads and writes only: what a request may do is
 * decided by the Effects below, which reach this through RoomStore.
 */
export class RoomDb {
  constructor(
    readonly sql: Sql,
    readonly roomId: string,
  ) {
    // A room created by an older relay gets the columns this one reads before anything reads them,
    // once per storage handle (a Durable Object instance, a Bun relay's database), not per request.
    if (!migrated.has(sql) && this.exists() && !this.isLegacy()) {
      this.migrate();
      migrated.add(sql);
    }
  }

  /** Tables exist only once a room is created, so a closed room leaves nothing behind. */
  exists(): boolean {
    return this.sql.all("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").length > 0;
  }

  /** A room from before owner-gated channels: it has data but no owner. Such rooms are deleted on sight. */
  isLegacy(): boolean {
    return this.exists() && !this.get("owner_pk");
  }

  init(): void {
    this.sql.run("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    this.sql.run("CREATE TABLE msgs (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL, e INTEGER NOT NULL)");
    // Former members keep their sealed record (so their history still verifies) but lose every key.
    this.sql.run(
      "CREATE TABLE members (pk TEXT PRIMARY KEY, xpk TEXT NOT NULL, rec TEXT NOT NULL, rec_e INTEGER NOT NULL, since INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, read_only INTEGER NOT NULL DEFAULT 0, admits_until INTEGER, admitted_by TEXT)",
    );
    this.sql.run("CREATE TABLE keys (pk TEXT NOT NULL, e INTEGER NOT NULL, wrapped TEXT NOT NULL, PRIMARY KEY (pk, e))");
    // Every column at once: each ALTER TABLE is a row written, and a new room paid eight of them.
    this.sql.run(
      `CREATE TABLE requests (id TEXT PRIMARY KEY, pk TEXT NOT NULL UNIQUE, xpk TEXT NOT NULL, box TEXT NOT NULL, sig TEXT NOT NULL, ts INTEGER NOT NULL, status TEXT NOT NULL, ${REQUEST_COLUMNS.map(([col, def]) => `${col} ${def}`).join(", ")})`,
    );
    this.sql.run(READS_TABLE);
  }

  /** A room from before a column existed gets it added (a new room is created with all of them). */
  migrate(): void {
    // A key the owner lets only read (member scopes): the one bit of them the relay knows.
    const memberCols = new Set(this.sql.all<{ name: string }>("PRAGMA table_info(members)").map((c) => c.name));
    if (!memberCols.has("read_only")) this.sql.run("ALTER TABLE members ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0");
    // A linked computer's seat: until when it may let its own agents in, and which computer let each one in.
    if (!memberCols.has("admits_until")) this.sql.run("ALTER TABLE members ADD COLUMN admits_until INTEGER");
    if (!memberCols.has("admitted_by")) this.sql.run("ALTER TABLE members ADD COLUMN admitted_by TEXT");
    if (!memberCols.has("gone")) this.sql.run("ALTER TABLE members ADD COLUMN gone TEXT");
    const cols = new Set(this.sql.all<{ name: string }>("PRAGMA table_info(requests)").map((c) => c.name));
    for (const [col, def] of REQUEST_COLUMNS) {
      if (!cols.has(col)) this.sql.run(`ALTER TABLE requests ADD COLUMN ${col} ${def}`);
    }
    this.sql.run(READS_TABLE.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
  }

  /** How far each current member has read. */
  reads(): ReadMark[] {
    return this.sql.all<ReadMark>("SELECT r.pk AS pk, r.seq AS seq, r.at AS at FROM reads r JOIN members m ON m.pk = r.pk AND m.active = 1");
  }

  get(k: string): string | undefined {
    return this.sql.all<{ v: string }>("SELECT v FROM meta WHERE k = ?", k)[0]?.v;
  }

  set(k: string, v: string | number): void {
    this.sql.run("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", k, String(v));
  }

  /** The signed-in human (WorkOS user id) who owns this channel, when the relay requires sign-in. */
  ownerUser(): string | undefined {
    return this.get("owner_user");
  }

  isMember(pk: string): boolean {
    return this.sql.all("SELECT 1 FROM members WHERE pk = ? AND active = 1", pk).length > 0;
  }

  head(): number {
    return this.sql.all<{ s: number | null }>("SELECT MAX(seq) AS s FROM msgs")[0]?.s ?? 0;
  }

  /**
   * What the channel holds and has stored today, in one meta row, so a message pays one write for
   * both counters instead of three. Absent in rooms from before it: bytes are then counted once.
   */
  counters(): Counters | null {
    const raw = this.get("usage");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Counters;
    } catch {
      return null;
    }
  }

  setCounters(u: Counters): void {
    this.set("usage", JSON.stringify(u));
  }

  /** Messages stored on the UTC day of `now`: the counter starts over when the date changes. */
  messagesOn(now: number): number {
    const u = this.counters();
    return u?.day === utcDay(now) ? u.n : 0;
  }

  /** Total ciphertext the channel holds. */
  storedBytes(): number {
    const u = this.counters();
    if (u) return u.bytes;
    const total = this.sql.all<{ n: number }>("SELECT COALESCE(SUM(LENGTH(ct)), 0) AS n FROM msgs")[0]?.n ?? 0;
    this.setCounters({ bytes: total, day: "", n: 0 });
    return total;
  }

  /** Delete messages through `seq`; returns the ciphertext bytes freed. */
  dropThrough(seq: number): number {
    if (seq <= 0) return 0;
    const freed = this.sql.all<{ n: number }>("SELECT COALESCE(SUM(LENGTH(ct)), 0) AS n FROM msgs WHERE seq <= ?", seq)[0]?.n ?? 0;
    if (freed) this.sql.run("DELETE FROM msgs WHERE seq <= ?", seq);
    return freed;
  }

  /** Delete the oldest messages until at least `need` bytes are free; returns the bytes freed. */
  dropOldest(need: number): number {
    let freed = 0;
    let through = 0;
    for (const r of this.sql.all<{ seq: number; n: number }>("SELECT seq, LENGTH(ct) AS n FROM msgs ORDER BY seq")) {
      freed += r.n;
      through = r.seq;
      if (freed >= need) break;
    }
    return this.dropThrough(through);
  }

  /** How many members (people and agents) are in the channel now. */
  activeMembers(): number {
    return this.sql.all<{ n: number }>("SELECT COUNT(*) AS n FROM members WHERE active = 1")[0]?.n ?? 0;
  }

  since(seq: number, limit = PAGE_LIMIT): Envelope[] {
    return this.sql.all<Envelope>("SELECT seq, ts, iv, ct, e FROM msgs WHERE seq > ? ORDER BY seq LIMIT ?", seq, Math.min(Math.max(limit, 1), PAGE_LIMIT));
  }

  /** The channel's sealed icon (owner-set; the relay can't read it). */
  icon(): { e: number; iv: string; ct: string } | null {
    const t = this.get("icon");
    return t ? (JSON.parse(t) as { e: number; iv: string; ct: string }) : null;
  }

  /** When the icon last changed. */
  iconAt(): number | null {
    return Number(this.get("icon_at")) || null;
  }

  /** The owner's separate promise that titles are signed, if /create sent one. */
  getTitlesSig(): string | null {
    return this.get("titles_sig") || null;
  }

  /** The channel's sealed name, if its creator gave one. The relay can't read it. */
  title(): { iv: string; ct: string } | null {
    const t = this.get("title");
    return t ? (JSON.parse(t) as { iv: string; ct: string }) : null;
  }

  /** The channel's sealed settings (its mode and rooms), signed by the owner. The relay can't read them. */
  settings(): { iv: string; ct: string } | null {
    const t = this.get("settings");
    return t ? (JSON.parse(t) as { iv: string; ct: string }) : null;
  }

  /** Before closing: drop this channel from its owner's owned-channel count. */
  unlinkAll(): DirectoryUpdate[] {
    const owner = this.ownerUser();
    return owner ? [{ user: owner, room: this.roomId, entry: null }] : [];
  }

  /** `read_only`: the relay refuses that key's posts, so the owner can check the bit matches what they set. */
  members(): { pk: string; xpk: string; rec: string; e: number; active: number; read_only: number }[] {
    return this.sql.all("SELECT pk, xpk, rec, rec_e AS e, active, read_only FROM members ORDER BY since");
  }

  pendingRequests(): (RequestBody & { kind: string; ownerNonce: string | null; reveal: string | null })[] {
    this.migrate();
    return this.sql.all(
      "SELECT id, pk, xpk, box, sig, ts, commit_to AS \"commit\", owner_nonce AS ownerNonce, reveal, kind FROM requests WHERE status = 'pending' AND commit_to IS NOT NULL ORDER BY COALESCE(received, ts)",
    );
  }

  deny(id: string): void {
    this.sql.run("UPDATE requests SET status = 'denied' WHERE id = ?", id);
  }
}

/** The room a request, socket or alarm is for. */
export class RoomStore extends Context.Service<RoomStore, RoomDb>()("kiwi/relay/RoomStore") {}

/** What every room Effect may need besides the request. */
export type RoomServices = RoomStore | Policy;

// ---------- the room's rules ----------

const gone = () => new ChannelGone({ message: "no such channel" });

/** The owner's keys and the epoch; a room with no tables is gone. */
export const readMeta = Effect.gen(function* () {
  const db = yield* RoomStore;
  if (!db.exists()) return yield* gone();
  const m: Meta = {
    ownerPk: db.get("owner_pk")!,
    ownerXpk: db.get("owner_xpk")!,
    ownerSig: db.get("owner_sig")!,
    epoch: Number(db.get("epoch") ?? 0),
    rotate: db.get("rotate") === "1",
  };
  return m;
});

function goneOf(db: RoomDb, pk: string): GoneHow | null {
  db.migrate();
  const how = db.sql.all<{ gone: string | null }>("SELECT gone FROM members WHERE pk = ? AND active = 0", pk)[0]?.gone;
  return how === "owner" || how === "left" ? how : null;
}

/** The member key that signed this request, or a 401/403. */
export const authenticate = Effect.fn("Room.authenticate")(function* (req: Request, method: string, path: string, body: string) {
  const db = yield* RoomStore;
  // A closed channel has no tables at all: say so, so members forget it.
  if (!db.exists()) return yield* gone();
  const pk = yield* Effect.promise(() => verifyRequest(requestToken(req), db.roomId, method, path, body));
  if (!pk) return yield* new Unauthorized({ message: "bad or expired signature" });
  if (!db.isMember(pk)) {
    const how = goneOf(db, pk);
    return yield* how ? new NotMember({ message: `not a member of this channel: ${GONE_WORDS[how]}` }) : new NotMember({ message: "not a member of this channel" });
  }
  return pk;
});

/** Authenticate a WebSocket upgrade; returns the member key. */
export const authenticateSocket = (req: Request) => authenticate(req, "GET", "/ws", "");

export const append = Effect.fn("Room.append")(function* (iv: string, ct: string, e: number, sender: string) {
  const db = yield* RoomStore;
  const policy = yield* Policy;
  // Every client refuses a read-only member's messages anyway; refusing them here keeps them out of storage.
  if (db.sql.all("SELECT 1 FROM members WHERE pk = ? AND read_only = 1", sender).length) return yield* new ReadOnly({ message: READ_ONLY });
  if (!fits(StoredEnvelope, { iv, ct })) return yield* new BadRequest({ message: "bad envelope" });
  if (ct.length > MAX_CT_LENGTH) return yield* new TooLarge({ message: "message too large" });
  const { epoch } = yield* readMeta;
  // Sealed with a retired key: the sender must fetch the new one and resend.
  if (e !== epoch) return yield* new Conflict({ message: `stale key epoch ${e}; current is ${epoch}` });
  const ts = yield* Clock.currentTimeMillis;

  // Messages per channel per UTC day.
  const day = utcDay(ts);
  const today = db.messagesOn(ts);
  const perDay = policy.messagesPerDay;
  if (perDay && today >= perDay) {
    return yield* new TooMany({ message: `this channel has stored ${perDay} messages today, its daily limit; more can be sent after 00:00 UTC (in ${untilUtcMidnight(ts)})` });
  }

  // Stored bytes per channel: the oldest messages make room, the way the 10,000-message
  // retention already works, so a busy channel never freezes. Only a message bigger than
  // the whole allowance is refused.
  const cap = policy.bytesPerChannel;
  if (ct.length > cap) return yield* new TooLarge({ message: `that message is bigger than this channel may hold (${formatBytes(cap)})` });
  let bytes = db.storedBytes();
  if (bytes + ct.length > cap) bytes -= db.dropOldest(bytes + ct.length - cap);

  db.sql.run("INSERT INTO msgs (ts, iv, ct, e) VALUES (?, ?, ?, ?)", ts, iv, ct, e);
  const seq = db.head();
  bytes += ct.length;
  // Prune in batches so retention costs one extra write pass per 100 messages.
  if (seq % 100 === 0) bytes -= db.dropThrough(seq - ROOM_RETENTION);
  db.setCounters({ bytes, day, n: today + 1 });
  const stored: Envelope = { seq, ts, iv, ct, e };
  return stored;
});

// ---------- idle rooms expire ----------

/**
 * Note activity (a stored message, a connection). On relays that expire idle rooms, returns
 * when this room expires if nothing else happens. Written at most once an hour, so a busy
 * room doesn't pay a write per message for it.
 */
export const touch: Effect.Effect<number | null, never, RoomServices> = Effect.gen(function* () {
  const db = yield* RoomStore;
  const days = (yield* Policy).expireAfterDays;
  if (!days || !db.exists()) return null;
  const now = yield* Clock.currentTimeMillis;
  if (now - Number(db.get("active") ?? 0) < 3_600_000 && db.get("room")) return null;
  db.set("active", now);
  // The Worker's alarm runs without a request, so the room keeps its own id.
  db.set("room", db.roomId);
  return now + days * 86_400_000;
});

/** Whether the room has gone quiet for longer than the relay keeps idle rooms. */
export const idleExpired: Effect.Effect<boolean, never, RoomServices> = Effect.gen(function* () {
  const db = yield* RoomStore;
  const days = (yield* Policy).expireAfterDays;
  if (!days || !db.exists()) return false;
  const last = Number(db.get("active") ?? db.get("created") ?? 0);
  return (yield* Clock.currentTimeMillis) - last >= days * 86_400_000;
});

/** Expire exactly as a close would: off everyone's channel list, then every row gone. */
export const expire: Effect.Effect<Effects, never, RoomStore> = Effect.map(RoomStore, (db) => ({ directory: db.unlinkAll(), wipe: true }));

// ---------- lifecycle ----------

/**
 * Create the room. The owner signs its own public keys; the request itself
 * must be signed by the owner. `members` must include the owner and may
 * include the creating agent.
 */
export const create = Effect.fn("Room.create")(function* (signer: string | null, body: CreateBody, ownerUser: string | null = null) {
  const db = yield* RoomStore;
  if (db.exists()) return yield* new Conflict({ message: "channel already exists" });
  const { owner, members } = body;
  if (!owner || signer !== owner.pk) return yield* new Unauthorized({ message: "create must be signed by the owner" });
  const signed = yield* Effect.promise(
    async () =>
      (await verify({ room: db.roomId, pk: owner.pk, xpk: owner.xpk, v: 2, sig: owner.sig })) || (await verify({ room: db.roomId, pk: owner.pk, xpk: owner.xpk, sig: owner.sig })),
  );
  if (!signed) return yield* new BadRequest({ message: "bad owner signature" });
  if (!members?.some((m) => m.pk === owner.pk)) return yield* new BadRequest({ message: "the owner must be a member" });
  // The member quota holds from the start, not only when the owner approves someone later.
  const most = (yield* Policy).membersPerChannel;
  if (most && new Set(members.map((m) => m.pk)).size > most) return yield* new TooMany({ message: `a channel may have at most ${most} members on this relay` });
  db.init();
  db.set("owner_pk", owner.pk);
  db.set("owner_xpk", owner.xpk);
  db.set("owner_sig", owner.sig);
  // Separate from owner_sig, so a 0.7 client still verifies the key statement. The relay can drop it.
  if (typeof owner.titlesSig === "string" && owner.titlesSig.length > 0 && owner.titlesSig.length < 200) db.set("titles_sig", owner.titlesSig);
  db.set("epoch", 0);
  db.set("created", Date.now());
  if (ownerUser) db.set("owner_user", ownerUser);
  // The channel's name, sealed with its key: members can read it, the relay can't.
  if (body.title && typeof body.title.iv === "string" && typeof body.title.ct === "string" && body.title.ct.length < 2048) db.set("title", JSON.stringify(body.title));
  // The owner may always post, whatever the body says.
  for (const m of members) yield* putMember(m.pk === owner.pk ? { ...m, post: true } : m, 0);
});

/** Replace the sealed icon, or clear it with null; returns when it changed. The caller has already checked that this is the owner. */
export const setIcon = Effect.fn("Room.setIcon")(function* (icon: unknown) {
  const db = yield* RoomStore;
  const at = Date.now();
  if (icon === null) db.set("icon", "");
  else {
    // About a 32KB image, sealed and base64'd, with room to spare; nothing bigger; and a key this channel has.
    if (!fits(SealedIcon, icon) || icon.e > (yield* readMeta).epoch) return yield* new BadRequest({ message: "bad icon (at most 32KB, sealed with a channel key)" });
    db.set("icon", JSON.stringify({ e: icon.e, iv: icon.iv, ct: icon.ct }));
  }
  db.set("icon_at", at);
  return at;
});

/** A sealed blob the owner replaces (the title, the settings): an iv, and a ciphertext under `max`. */
const sealedUnder = (x: unknown, max: number): { iv: string; ct: string } | null => {
  const t = x as { iv?: unknown; ct?: unknown };
  return typeof t?.iv !== "string" || typeof t.ct !== "string" || t.ct.length === 0 || t.ct.length >= max ? null : { iv: t.iv, ct: t.ct };
};

/** Replace the sealed name. The caller has already checked that this is the owner. */
export const setTitle = Effect.fn("Room.setTitle")(function* (title: unknown) {
  const db = yield* RoomStore;
  const t = sealedUnder(title, 2048);
  if (!t) return yield* new BadRequest({ message: "bad title" });
  db.set("title", JSON.stringify(t));
});

/** Replace the sealed settings. The caller has already checked that this is the owner. */
export const setSettings = Effect.fn("Room.setSettings")(function* (settings: unknown) {
  const db = yield* RoomStore;
  const t = sealedUnder(settings, 16_384);
  if (!t) return yield* new BadRequest({ message: "bad settings" });
  db.set("settings", JSON.stringify(t));
});

// ---------- who owns this channel ----------

/** The owner's owned-channel count, for the quota on POST /create: on after create, off after close. */
export const directory: Effect.Effect<DirectoryUpdate[], ChannelGone, RoomStore> = Effect.gen(function* () {
  const db = yield* RoomStore;
  const owner = db.ownerUser();
  if (!owner) return [];
  const { ownerPk } = yield* readMeta;
  const code = encodeJoinCode({ roomId: db.roomId, ownerFp: yield* Effect.promise(() => ownerFingerprint(ownerPk)) });
  const at = Number(db.get("created") ?? Date.now());
  return [{ user: owner, room: db.roomId, entry: { room: db.roomId, code, owner: true, member: true, agents: 0, at } }];
});

const putMember = Effect.fn("Room.putMember")(function* (m: MemberBody, epoch: number) {
  const db = yield* RoomStore;
  if (!fits(MemberRecord, m)) return yield* new BadRequest({ message: "bad member" });
  // Only keys for epochs the channel has had, named by their number: one per epoch, never more.
  if (Object.keys(m.keys ?? {}).some((e) => !/^\d{1,9}$/.test(e) || Number(e) > epoch)) return yield* new BadRequest({ message: "bad member" });
  db.sql.run(
    "INSERT INTO members (pk, xpk, rec, rec_e, since, active, read_only) VALUES (?, ?, ?, ?, ?, 1, ?) ON CONFLICT (pk) DO UPDATE SET xpk = excluded.xpk, rec = excluded.rec, rec_e = excluded.rec_e, active = 1, read_only = excluded.read_only",
    m.pk,
    m.xpk,
    m.rec,
    epoch,
    Date.now(),
    m.post === false ? 1 : 0,
  );
  for (const [e, wrapped] of Object.entries(m.keys ?? {})) {
    db.sql.run("INSERT OR REPLACE INTO keys (pk, e, wrapped) VALUES (?, ?, ?)", m.pk, Number(e), wrapped);
  }
});

// ---------- join requests ----------

/**
 * File a join request. The requester's name and role are sealed to the owner (the relay can't
 * read them); the relay checks only the signature, the join-check commit and the room's own
 * limits. Who vouches for whom is the owner's call, from the sealed claims, never the relay's.
 */
export const request = Effect.fn("Room.request")(function* (body: RequestBody) {
  const db = yield* RoomStore;
  yield* readMeta;
  db.migrate();
  const { pk, xpk, box, ts, sig, commit } = body ?? ({} as RequestBody);
  if (typeof commit !== "string") return yield* new UpdateRequired({ message: UPDATE_KIWI });
  if (!fits(JoinRequest, body)) return yield* new BadRequest({ message: "bad request" });
  if (box.length > 4096) return yield* new TooLarge({ message: "request too large" });
  if (!(yield* Effect.promise(() => verify({ room: db.roomId, pk, xpk, box, ts, commit, sig })))) return yield* new BadRequest({ message: "bad request signature" });
  // The requester signed `ts` by its own clock, so it's checked against the wall clock.
  if (Math.abs(Date.now() - ts) > REQUEST_TTL_MS) return yield* new BadRequest({ message: "request timestamp out of range" });
  if (db.isMember(pk)) return yield* new Conflict({ message: "already a member" });
  // Expiry and order use when the relay received a request, not the time the requester claims.
  db.sql.run("DELETE FROM requests WHERE status = 'pending' AND COALESCE(received, ts) < ?", Date.now() - REQUEST_TTL_MS);
  const existing = db.sql.all<{ id: string; status: string }>("SELECT id, status FROM requests WHERE pk = ?", pk)[0];
  if (existing?.status === "denied") return yield* new Denied({ message: "this key was denied" });
  if (db.sql.all("SELECT 1 FROM members WHERE pk = ? AND active = 0", pk).length) return yield* new Removed({ message: "this key was removed; join with a new identity" });
  if (existing) {
    // A joiner that lost its nonce starts the check over; the owner signs the new commit.
    db.sql.run(
      "UPDATE requests SET commit_to = ?, box = ?, sig = ?, ts = ?, owner_nonce = NULL, reveal = NULL WHERE id = ? AND status = 'pending' AND commit_to IS NOT ?",
      commit,
      box,
      sig,
      ts,
      existing.id,
      commit,
    );
    return { id: existing.id, fresh: false };
  }
  const pending = db.sql.all<{ n: number }>("SELECT COUNT(*) AS n FROM requests WHERE status = 'pending'")[0]!.n;
  if (pending >= MAX_PENDING) return yield* new TooMany({ message: "too many pending join requests" });
  const id = crypto.randomUUID();
  db.sql.run("INSERT INTO requests (id, pk, xpk, box, sig, ts, status, kind, received, commit_to) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'agent', ?, ?)", id, pk, xpk, box, sig, ts, Date.now(), commit);
  return { id, fresh: true };
});

/** Where a request stands, for the key that made it: and its wrapped keys, once it's in. */
export const requestStatus = Effect.fn("Room.requestStatus")(function* (id: string, pk: string) {
  const db = yield* RoomStore;
  yield* readMeta;
  db.migrate();
  const r = db.sql.all<{ pk: string; status: string; owner_nonce: string | null; reveal: string | null }>("SELECT pk, status, owner_nonce, reveal FROM requests WHERE id = ?", id)[0];
  if (!r || r.pk !== pk) return yield* new NotFound({ message: "no such request" });
  if (r.status === "pending") return { status: r.status, ownerNonce: r.owner_nonce, revealed: !!r.reveal } satisfies RequestStatus;
  if (r.status !== "approved" || !db.isMember(pk)) return { status: r.status } satisfies RequestStatus;
  return { status: "approved", ...(yield* keysFor(pk)) } satisfies RequestStatus;
});

type RequestStatus = { status: string; ownerNonce?: string | null; revealed?: boolean; epoch?: number; keys?: Record<string, string> };

const pendingCheck = Effect.fn("Room.pendingCheck")(function* (id: string) {
  const db = yield* RoomStore;
  db.migrate();
  const r = db.sql.all<{ pk: string; commit: string | null; ownerNonce: string | null; reveal: string | null }>(
    "SELECT pk, commit_to AS \"commit\", owner_nonce AS ownerNonce, reveal FROM requests WHERE id = ? AND status = 'pending'",
    id,
  )[0];
  if (!r?.commit) return yield* new NotFound({ message: "no such pending request" });
  return r as { pk: string; commit: string; ownerNonce: string | null; reveal: string | null };
});

/** The owner's half of the join check: its signature over the joiner's commit. Set once. */
export const setOwnerNonce = Effect.fn("Room.setOwnerNonce")(function* (id: string, nonce: unknown) {
  const db = yield* RoomStore;
  const r = yield* pendingCheck(id);
  const { ownerPk } = yield* readMeta;
  if (typeof nonce !== "string" || !(yield* Effect.promise(() => verifyText(ownerPk, nonce, ownerNonceStatement(db.roomId, r.pk, r.commit))))) {
    return yield* new BadRequest({ message: "that isn't the owner's signature over this request" });
  }
  if (r.ownerNonce && r.ownerNonce !== nonce) return yield* new Conflict({ message: "this request already has the owner's nonce" });
  db.sql.run("UPDATE requests SET owner_nonce = ? WHERE id = ?", nonce, id);
});

/** The joiner's half, revealed once the owner's is in: it has to match the commit. True when it's new. */
export const reveal = Effect.fn("Room.reveal")(function* (id: string, pk: string, nonce: unknown) {
  const db = yield* RoomStore;
  const r = yield* pendingCheck(id);
  if (r.pk !== pk) return yield* new NotFound({ message: "no such pending request" });
  if (!r.ownerNonce) return yield* new Conflict({ message: "wait for the owner's half of the check" });
  if (typeof nonce !== "string" || !NONCE_RE.test(nonce) || (yield* Effect.promise(() => commitTo(db.roomId, pk, nonce))) !== r.commit) {
    return yield* new BadRequest({ message: "that nonce doesn't match the request" });
  }
  if (r.reveal === nonce) return false;
  db.sql.run("UPDATE requests SET reveal = ? WHERE id = ?", nonce, id);
  return true;
});

/** Nobody is let in before both sides could compare the code. */
export const requireChecked = Effect.fn("Room.requireChecked")(function* (request: string | undefined, pk: string) {
  const db = yield* RoomStore;
  db.migrate();
  const r = request ? db.sql.all<{ pk: string; reveal: string | null }>("SELECT pk, reveal FROM requests WHERE id = ? AND status = 'pending'", request)[0] : undefined;
  if (!r || r.pk !== pk) return yield* new BadRequest({ message: "approve a pending request" });
  if (!r.reveal) return yield* new Conflict({ message: "this request hasn't finished its code check yet" });
});

// ---------- members & keys ----------

/**
 * Admit a member. A membership never moves to a new key (SECURITY.md): a body that still names a
 * seat to take over (`replaces`, the old reclaim) is refused like any other bad member.
 */
export const approve = Effect.fn("Room.approve")(function* (body: MemberBody & { request?: string }) {
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
  yield* putMember(body, epoch);
  if (body.request) db.sql.run("UPDATE requests SET status = 'approved' WHERE id = ? AND pk = ?", body.request, body.pk);
});

/** A member's wrapped channel keys, by epoch, and the current epoch. */
export const keysFor = Effect.fn("Room.keysFor")(function* (pk: string) {
  const db = yield* RoomStore;
  const rows = db.sql.all<{ e: number; wrapped: string }>("SELECT e, wrapped FROM keys WHERE pk = ?", pk);
  return { epoch: (yield* readMeta).epoch, keys: Object.fromEntries(rows.map((r) => [String(r.e), r.wrapped])) as Record<string, string> };
});

/**
 * The owner re-signs a member's record when what they may do changes (sealed: the relay can't read
 * it), and sets the "can post" bit with it, in one step. `e` is the epoch whose key sealed it.
 */
export const setRecord = Effect.fn("Room.setRecord")(function* (pk: string, rec: string, e: number, post: boolean) {
  const db = yield* RoomStore;
  if (pk === (yield* readMeta).ownerPk) return yield* new BadRequest({ message: "the owner's record isn't changed this way" });
  if (!db.isMember(pk)) return yield* new NotFound({ message: "not a member" });
  if (!Number.isInteger(e) || e < 0 || e > (yield* readMeta).epoch) return yield* new BadRequest({ message: "no such epoch" });
  if (rec.length > MAX_RECORD) return yield* new TooLarge({ message: "record too large" });
  db.migrate();
  db.sql.run("UPDATE members SET rec = ?, rec_e = ?, read_only = ?, admitted_by = NULL WHERE pk = ?", rec, e, post ? 0 : 1, pk);
});

/** Whether a member may post (the owner's scope.set says what they may do; this is the bit the relay enforces). */
export const setCanPost = Effect.fn("Room.setCanPost")(function* (pk: string, post: boolean) {
  const db = yield* RoomStore;
  if (pk === (yield* readMeta).ownerPk) return yield* new BadRequest({ message: "the owner may always post" });
  if (!db.isMember(pk)) return yield* new NotFound({ message: "not a member" });
  db.migrate();
  db.sql.run("UPDATE members SET read_only = ?, admitted_by = NULL WHERE pk = ?", post ? 0 : 1, pk);
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
  // Its keys are revoked at the relay; the owner rotates so they also can't decrypt anything newer.
  db.set("rotate", 1);
});

/** A member has read up to `seq`: kept only when it moves forward, and never past the head. Null when nothing changed. */
export const markRead = Effect.fn("Room.markRead")(function* (pk: string, seq: unknown) {
  const db = yield* RoomStore;
  if (!Number.isSafeInteger(seq) || (seq as number) < 1) return yield* new BadRequest({ message: "seq must be a positive whole number" });
  const upTo = Math.min(seq as number, db.head());
  const was = db.sql.all<{ seq: number }>("SELECT seq FROM reads WHERE pk = ?", pk)[0]?.seq ?? 0;
  if (upTo <= was) return null;
  const at = yield* Clock.currentTimeMillis;
  db.sql.run("INSERT INTO reads (pk, seq, at) VALUES (?, ?, ?) ON CONFLICT (pk) DO UPDATE SET seq = excluded.seq, at = excluded.at", pk, upTo, at);
  return { pk, seq: upTo, at } satisfies ReadMark;
});

export const rotate = Effect.fn("Room.rotate")(function* (epoch: number, keys: Record<string, string>) {
  const db = yield* RoomStore;
  const meta = yield* readMeta;
  if (epoch !== meta.epoch + 1) return yield* new Conflict({ message: `next epoch is ${meta.epoch + 1}` });
  const members = db.members().filter((m) => m.active);
  for (const m of members) if (!keys[m.pk]) return yield* new BadRequest({ message: `missing wrapped key for ${m.pk.slice(0, 8)}` });
  for (const m of members) if (typeof keys[m.pk] !== "string" || keys[m.pk]!.length > MAX_WRAPPED) return yield* new BadRequest({ message: "bad wrapped key" });
  for (const m of members) db.sql.run("INSERT OR REPLACE INTO keys (pk, e, wrapped) VALUES (?, ?, ?)", m.pk, epoch, keys[m.pk]!);
  db.set("epoch", epoch);
  db.set("rotate", 0);
});

export interface MemberBody {
  pk: string;
  xpk: string;
  /** Owner-signed member record, sealed with the channel key (the relay can't read names). */
  rec: string;
  /** Channel keys by epoch, each sealed to this member's `xpk`. */
  keys?: Record<string, string>;
  /** False for a member the owner lets only read: the relay refuses their messages. */
  post?: boolean;
}

export interface CreateBody {
  /** The channel's name, sealed with the epoch-0 key. */
  title?: { iv: string; ct: string };
  owner: { pk: string; xpk: string; sig: string; titlesSig?: string };
  members: MemberBody[];
}

export interface RequestBody {
  id?: string;
  pk: string;
  xpk: string;
  /** Name/role/about, sealed to the owner's xpk. */
  box: string;
  ts: number;
  /** The joiner's commitment to its half of the code (see sas.ts). */
  commit: string;
  sig: string;
}

// ---------- sockets ----------

export function msgFrame(e: Envelope): string {
  return frame({ t: "msg", ...e });
}

/** Frames to send a newly connected socket: the backlog after `since`, then ready. */
export const welcomeFrames = (since: number): Effect.Effect<string[], never, RoomStore> =>
  Effect.map(RoomStore, (db) => {
    const backlog = db.since(since);
    const head = db.head();
    const last = backlog.at(-1)?.seq ?? since;
    return [...backlog.map(msgFrame), frame({ t: "reads", reads: db.reads() }), frame({ t: "ready", head, more: last < head })];
  });

/** Handle one frame from an authenticated socket. It never fails: whatever goes wrong is the sender's err frame. */
export const onClientFrame = Effect.fn("Room.onClientFrame")(function* (raw: string, sender = "") {
  const db = yield* RoomStore;
  let f: ClientFrame;
  try {
    f = JSON.parse(raw);
  } catch {
    return { reply: frame({ t: "err", error: "bad json" }) } satisfies Effects;
  }
  if (f.t === "eph") {
    // Presence and other ephemeral signals: relayed, never stored, never acked.
    if (!allow(`eph:${db.roomId}:${sender}`, EPHEMERAL_PER_MINUTE)) return { reply: frame({ t: "err", error: "too many ephemeral frames; slow down" }) } satisfies Effects;
    if (typeof f.iv !== "string" || typeof f.ct !== "string" || f.ct.length > MAX_EPH_LENGTH) {
      return { reply: frame({ t: "err", error: "bad ephemeral frame" }) } satisfies Effects;
    }
    return { others: frame({ t: "eph", iv: f.iv, ct: f.ct }) } satisfies Effects;
  }
  if (f.t === "read") {
    // How far this member has read: kept and passed on only when it moves forward. Too many is just dropped.
    if (!allow(`read:${db.roomId}:${sender}`, READS_PER_MINUTE)) return {} satisfies Effects;
    return yield* markRead(sender, f.seq).pipe(
      Effect.map((mark): Effects => (mark ? { broadcast: [frame({ t: "read", ...mark })] } : {})),
      Effect.catchCause((cause) =>
        Effect.succeed<Effects>(isRefusal(Cause.squash(cause)) ? { reply: frame({ t: "err", error: "bad read mark" }) } : { reply: frame({ t: "err", error: socketError(cause) }) }),
      ),
    );
  }
  if (f.t !== "send") return { reply: frame({ t: "err", error: "unknown frame" }) } satisfies Effects;
  if (!allow(`${db.roomId}:${sender}`, MESSAGES_PER_MINUTE)) return { reply: frame({ t: "err", error: "too many messages; wait a minute", id: f.id }) } satisfies Effects;
  const send = f;
  return yield* Effect.gen(function* () {
    const e = yield* append(send.iv, send.ct, Number(send.e ?? 0), sender);
    const fx: Effects = { broadcast: [msgFrame(e)], reply: frame({ t: "ack", id: send.id, seq: e.seq }), expireAt: (yield* touch) ?? undefined };
    return fx;
  }).pipe(
    // A refusal says why; a storage error is logged and the sender hears only that it failed.
    Effect.catchCause((cause) => Effect.succeed<Effects>({ reply: frame({ t: "err", error: socketError(cause), id: send.id }) })),
  );
});

/**
 * The HTTP API (all under /v1/rooms/<room>):
 *   GET    /info?fp=<fingerprint>     holder of the join code: owner keys, epoch, whether a rotation is due
 *   POST   /create                    owner: create the room
 *   POST   /requests?fp=<fingerprint> holder of the join code: ask to join (self-signed)
 *   GET    /requests/<id>             the requester: status, and wrapped keys once approved
 *   POST   /requests/<id>/reveal      the requester: its half of the code check
 *   GET    /requests?v=2              owner: pending requests
 *   POST   /requests/<id>/nonce       owner: its half of the code check (a signature)
 *   POST   /requests/<id>/deny        owner
 *   POST   /members                   owner: approve (enroll a key, hand it wrapped keys)
 *   GET    /members                   member: the sealed member records
 *   DELETE /members/me                member: leave
 *   DELETE /members/<pk>              owner: remove
 *   PUT    /members/<pk>/post         owner: whether they may post (the relay's bit of member scopes)
 *   PUT    /members/<pk>/record       owner: a re-signed record (what they may do changed) and that bit, together
 *   GET    /keys                      member: my wrapped channel keys
 *   POST   /epochs                    owner: rotate the channel key
 *   DELETE /                          owner: close and delete everything
 *   GET    /                          member: {head}
 *   GET    /messages?since=N          member
 *   POST   /messages                  member: {iv, ct, e}
 *   POST   /read                      member: {seq}, how far it has read (a number, never content)
 */

/**
 * What a socket's sender is told when its frame fails: a refusal's own text; anything else is a bug
 * or an outage, logged without details, and "internal error", as over HTTP. Exception text never
 * reaches a member.
 */
export function socketError(cause: Cause.Cause<unknown>): string {
  const err = Cause.squash(cause);
  if (isRefusal(err)) return err.message;
  console.error(err instanceof Error ? err.message : "error");
  return "internal error";
}

/** A refusal as its response; anything else is a bug or an outage, logged without details, and a 500. */
export function errorResponse(err: unknown): Response {
  if (isRefusal(err)) return refusalResponse(err);
  // Never log request details: room ids and keys are nobody's business.
  console.error(err instanceof Error ? err.message : "error");
  return Response.json({ error: "internal error" }, { status: 500 });
}

/** Parse /v1/rooms/<roomId><rest>. */
export function parseRoomPath(pathname: string): { roomId: string; rest: string } | null {
  const m = /^\/v1\/rooms\/([0-9a-f]{32})(\/.*)?$/.exec(pathname);
  return m ? { roomId: m[1]!, rest: m[2] ?? "/" } : null;
}

/** Relay-wide settings the app needs: which WorkOS client to sign in with (to create), if any. Shape: { workosClientId, dev? }. */
export function relayConfig(human: HumanAuth | null): Response {
  return Response.json({ workosClientId: human?.clientId ?? null, ...(human?.dev ? { dev: true } : {}) });
}
