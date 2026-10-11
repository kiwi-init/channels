// Client for one membership channel: create it, ask to join, approve, send
// (signed), read history, stream live messages and presence, leave, close.
// Runs in Bun and in the browser.
//
// On Effect inside (docs/plans/effect.md, step 3). Every request goes through the
// Relay service; a refusal is a typed failure (RelayError, ChannelGone,
// Unreachable), never a message to match. The live connection is a Stream that
// reconnects on a Schedule, and interrupting it closes the socket. `ch.fx`,
// `Channel.fx` and `fx` are those Effects. The Promise methods, which the CLI, the
// agent and the dashboard call, run them and resolve or reject exactly as before.

import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { signRequest } from "./auth.ts";
import { isErrorTag, tagForStatus, type ErrorTag } from "./errors.ts";
import { BadName, MissingKey, OwnerOnly, Rejected, type LocalRefusal } from "./refusals.ts";
import {
  decodeJoinCode,
  encodeJoinCode,
  newChannelKey,
  newRoomId,
  open,
  openFrom,
  ownerFingerprint,
  seal,
  sealTo,
  type ChannelAccess,
} from "./crypto.ts";
import { sign, signText, verify, verifyText, type Identity } from "./identity.ts";
import { vouchStatement } from "./vouch.ts";
import { commitTo, joinCheckCode, joinNonce, ownerNonceStatement, spendAuto, type SigningBudget } from "./sas.ts";
import { canPost, scopesOf, wireScopes, type Scope } from "./scopes.ts";
import { COORDINATOR, type ChannelState, type GuardFloor } from "./state.ts";
import { handleFor, inlineText, makeRecord, NAME_RE, nameKey, openRecord, RESERVED_NAMES, sealRecord, type JoinRequest, type Member, type MemberInfo } from "./membership.ts";
import {
  CLOSE_CLOSED,
  CLOSE_REMOVED,
  GENERAL_ROOM,
  MAX_ICON_BYTES,
  MAX_CHARTER,
  MAX_ROOM_NAME,
  ROOM_ID_RE,
  MAX_IMAGES,
  isRasterMime,
  rasterAttachment,
  wellFormedIcon,
  type ChannelIcon,
  PING,
  PROTOCOL_VERSION,
  WS_PROTOCOL,
  wellFormed,
  type Envelope,
  type Event,
  type ImageAttachment,
  type Kind,
  type Message,
  type Payload,
  type Presence,
  type ServerFrame,
} from "./protocol.ts";

export interface SendOptions {
  to?: string[];
  kind?: Kind;
  re?: number[];
  ev?: Event;
  imgs?: ImageAttachment[];
  /** The room (an id) a chat message goes to; absent or "general" is general. */
  room?: string;
  /** An escalation: a decision handed to people (see Payload.esc). */
  esc?: boolean;
}

// ---------- what can go wrong ----------
//
// RelayError and ChannelGone stay the plain Errors callers have always caught
// (instanceof, .status, .tag, .why, and the same text). Their `_tag` lives on the
// prototype, for Effect's catchTag, so the errors themselves read as before.

export class RelayError extends Error {
  /** What the refusal means; read from the relay's answer, or from the status for relays that don't say. */
  readonly tag: ErrorTag;
  /** Whether the relay said the tag itself. Relays from before tags (0.7 and older) don't: then only the text tells. */
  readonly tagged: boolean;
  constructor(
    readonly status: number,
    message: string,
    tag?: unknown,
  ) {
    super(message);
    this.tagged = isErrorTag(tag);
    this.tag = isErrorTag(tag) ? tag : tagForStatus(status);
  }
  get _tag(): "RelayError" {
    return "RelayError";
  }
}

/** This member was removed, or the owner closed the channel. Local copies should be wiped. */
export class ChannelGone extends Error {
  constructor(readonly why: "removed" | "closed") {
    super(why === "closed" ? "the owner closed this channel" : "you are no longer a member of this channel");
  }
  get _tag(): "ChannelGone" {
    return "ChannelGone";
  }
}

/** The relay couldn't be reached at all (fetch itself failed). The Promise methods reject with what fetch threw, as they always have. */
export class Unreachable extends Data.TaggedError("Unreachable")<{ readonly cause: unknown }> {}

/** A socket that closed for no reason that's an answer (not removed, not closed, not "more"): connect again. */
class Dropped extends Data.TaggedError("Dropped")<{ readonly code: number; readonly reason: string }> {}

/** What a request can fail with: the relay refused it, or never heard it. */
export type Refusal = RelayError | Unreachable;
/** What a member's request can fail with: those, or this member being out of the channel. */
export type MemberRefusal = Refusal | ChannelGone;
/** What a member's operation can fail with: the relay's refusals, or this client's own (refusals.ts). */
export type Refused = MemberRefusal | LocalRefusal;

/** Map the relay errors that mean "you're out" to ChannelGone; leave everything else alone. */
function gone<E>(err: E): E | ChannelGone {
  if (!(err instanceof RelayError)) return err;
  // By tag; by text too, for relays from before tags (0.7 and older).
  if (err.tag === "NotMember" || (err.status === 403 && /not a member/.test(err.message))) return new ChannelGone("removed");
  if (err.tag === "ChannelGone" || (err.status === 404 && /no such channel/.test(err.message))) return new ChannelGone("closed");
  return err;
}

// ---------- the relay ----------

/** Supplies the signed-in human's WorkOS access token (relays that require sign-in). */
export type HumanSession = () => Promise<string | null>;

/** One request to a channel's route. */
export interface CallInit {
  method?: string;
  body?: string;
  /** Signs the request: the key the relay sees. */
  identity?: Identity;
  /** The signed-in person's session, on relays that require one. */
  human?: string | null;
}

export interface RelayApi {
  /** A channel's route, signed when `init.identity` is given. A refusal is a RelayError with the relay's own text. */
  readonly call: <T>(relay: string, roomId: string, path: string, init?: CallInit, params?: Record<string, string | number>) => Effect.Effect<T, Refusal>;
  /** A signed-in person's route (/v1/me/…). */
  readonly person: <T>(relay: string, path: string, human: string) => Effect.Effect<T, Refusal>;
  /** Whether a relay requires a signed-in human, and with which WorkOS client. */
  readonly config: (relay: string) => Effect.Effect<{ workosClientId: string | null }, Unreachable>;
}

/** The relay, as the client talks to it. `fetchRelay` is HTTP; a test or another transport provides its own. */
export class Relay extends Context.Service<Relay, RelayApi>()("kiwi/client/Relay") {}

/** What the relay answers a signature that's wrong or outside its time window. */
const EXPIRED_SIGNATURE = "bad or expired signature";

const reach = (url: URL, init: RequestInit) => Effect.tryPromise({ try: (signal) => fetch(url, { ...init, signal }), catch: (cause) => new Unreachable({ cause }) });

/** The answer's JSON (an empty object when it has none), or the refusal it is. */
const answered = <T>(res: Response) =>
  Effect.flatMap(
    Effect.promise(() => res.json().catch(() => ({})) as Promise<T & { error?: string; tag?: string }>),
    (json): Effect.Effect<T, RelayError> => (res.ok ? Effect.succeed(json) : Effect.fail(new RelayError(res.status, json.error ?? `relay returned ${res.status}`, json.tag))),
  );

const expired = (err: Refusal) => err instanceof RelayError && err.status === 401 && err.message === EXPIRED_SIGNATURE;

/** The relay over HTTP. */
export const fetchRelay: RelayApi = {
  call: <T>(relay: string, roomId: string, path: string, init: CallInit = {}, params: Record<string, string | number> = {}) =>
    Effect.suspend(() => {
      const u = new URL(`/v1/rooms/${roomId}${path}`, relay);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
      const method = (init.method ?? "GET").toUpperCase();
      const body = init.body ?? "";
      const { identity, human } = init;
      const once = Effect.gen(function* () {
        const headers: Record<string, string> = { "content-type": "application/json" };
        // The signature covers the query too, so a captured token can't be replayed with other parameters.
        if (identity) headers.authorization = `Bearer ${yield* Effect.promise(() => signRequest(identity, roomId, method, path + u.search, body))}`;
        if (human) headers["x-human-token"] = human;
        const res = yield* reach(u, { method, body: method === "GET" || method === "DELETE" ? undefined : body, headers });
        return yield* answered<T>(res);
      });
      // Signed, then the machine slept past the signature's window before it was sent: sign again,
      // once. The relay refused before doing anything, so even a write is safe to send twice.
      return Effect.retry(once, { times: 1, while: (err) => !!identity && expired(err) });
    }),
  person: <T>(relay: string, path: string, human: string) =>
    Effect.suspend(() => reach(new URL(path, relay), { headers: { "x-human-token": human } })).pipe(Effect.flatMap((res) => answered<T>(res))),
  config: (relay) =>
    Effect.suspend(() => reach(new URL("/v1/config", relay), {})).pipe(
      Effect.flatMap((res) => (res.ok ? Effect.promise(() => res.json() as Promise<{ workosClientId: string | null }>) : Effect.succeed({ workosClientId: null }))),
    ),
};

const callRelay = <T>(relay: string, roomId: string, path: string, init?: CallInit, params?: Record<string, string | number>) =>
  Effect.gen(function* () {
    return yield* (yield* Relay).call<T>(relay, roomId, path, init, params);
  });

/** An Effect's end as a Promise's: its value, or what it failed with (what fetch threw, for a relay out of reach). */
export function settle<A, E>(exit: Exit.Exit<A, E>): A {
  if (Exit.isSuccess(exit)) return exit.value;
  const err = Cause.squash(exit.cause);
  throw err instanceof Unreachable ? err.cause : err;
}

/** Run a client Effect over HTTP, as the Promise callers have always had. */
const run = <A, E>(effect: Effect.Effect<A, E, Relay>): Promise<A> => Effect.runPromiseExit(Effect.provideService(effect, Relay, fetchRelay)).then(settle);

/** Run until `signal` aborts. Stopped that way, it resolves, as the loop that checked `signal.aborted` did. */
const runUntil = <E>(effect: Effect.Effect<void, E, Relay>, signal?: AbortSignal): Promise<void> =>
  Effect.runPromiseExit(Effect.provideService(effect, Relay, fetchRelay), { signal }).then((exit) =>
    signal?.aborted && Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) ? undefined : settle(exit),
  );

// ---------- the live connection ----------

export interface StreamOptions {
  signal?: AbortSignal;
  onReady?: (head: number) => void;
  /** Connection trouble worth a line: only once the relay has been out of reach for `quietMs` (default QUIET_DROP_MS). */
  onStatus?: (s: string) => void;
  quietMs?: number;
  /**
   * Clock for the quiet window and the wait before a retry. A test moves it
   * forward so a long outage does not take wall-clock time. Unset, both follow
   * wall time.
   */
  now?: () => number;
  /** Called on every (re)connect with a way to send ephemeral presence. */
  onOpen?: (live: { presence: (p: PresenceFields) => Promise<void> }) => void;
  onPresence?: (p: Presence & { sigOk: boolean }) => void;
  /** The channel's info changed (its icon): refetch it. */
  onInfo?: () => void;
  /** The member list changed. */
  onRoster?: () => void;
  /** Someone asked to join (owners act on it). */
  onRequest?: () => void;
}

/** What a member says about itself in presence; the rest (version, name, time) is filled in. */
export type PresenceFields = Omit<Presence, "v" | "type" | "from" | "ts">;

/** What a live channel says, in order. */
export type Live =
  /**
   * Connected, or connected again. `outage` is how long the relay was out of reach, when that
   * was long enough to have said so (a Down came before); otherwise null.
   */
  | { readonly _tag: "Open"; readonly presence: (p: PresenceFields) => Effect.Effect<void>; readonly outage: number | null }
  /** Caught up: the relay's head when this connection's replay ended. */
  | { readonly _tag: "Ready"; readonly head: number }
  | { readonly _tag: "Message"; readonly message: Message }
  | { readonly _tag: "Presence"; readonly presence: Presence & { sigOk: boolean } }
  /** The channel's info changed, the member list changed, someone asked to join. */
  | { readonly _tag: "Info" | "Roster" | "Request" }
  /** The relay has been out of reach for the quiet window (`after` ms); still retrying. Said once per outage. */
  | { readonly _tag: "Down"; readonly after: number; readonly code: number; readonly reason: string }
  /** A frame that couldn't be read (a bad payload): dropped, and the stream goes on. */
  | { readonly _tag: "Skipped"; readonly frame: string; readonly error: unknown };

export interface LiveOptions {
  /** How long the relay may be out of reach before a Down (default QUIET_DROP_MS). */
  quietMs?: number;
  /** Open presence frames (default true). A listener that ignores presence skips the work. */
  presence?: boolean;
}

/** How long a dropped connection may stay down before listeners hear about it. */
export const QUIET_DROP_MS = 30_000;

/** The wait before connecting again: half a second, doubling, never more than 30s. */
const backoff = Schedule.min([Schedule.exponential("500 millis"), Schedule.spaced("30 seconds")]);

/** Whether this step of an outage is the one where it outlasted the quiet window (said once, so only the first). */
const outlasted = ({ attempt, elapsed, elapsedSincePrevious }: Schedule.InputMetadata<unknown>, quietMs: number) =>
  elapsed >= quietMs && (attempt === 1 || elapsed - elapsedSincePrevious < quietMs);

/** A frame from the socket, or the socket opening (with a way to send presence on it). */
type Incoming = ServerFrame | { t: "pong" } | { t: "open"; presence: (p: PresenceFields) => Effect.Effect<void> };

/** A ping now and then keeps proxies from closing a quiet socket. */
const keepAlive = (ws: WebSocket) =>
  Effect.sleep("25 seconds").pipe(
    Effect.andThen(Effect.sync(() => ws.readyState === WebSocket.OPEN && ws.send(PING))),
    Effect.forever,
  );

/** A real 10ms wait, for polling a test's clock. */
const tick = Effect.callback<void>((resume) => {
  const t = setTimeout(() => resume(Effect.void), 10);
  return Effect.sync(() => clearTimeout(t));
});

/**
 * A Clock that reads `now` (a test's), and whose sleeps poll it: moving it forward
 * ends a long wait early. The short real wait between polls keeps a clock that is
 * Date.now from spinning.
 */
function clockFrom(now: () => number): Clock.Clock {
  const nanos = () => BigInt(now()) * 1_000_000n;
  const until = (end: number): Effect.Effect<void> => Effect.suspend(() => (now() >= end ? Effect.void : Effect.andThen(tick, until(end))));
  return {
    currentTimeMillisUnsafe: now,
    currentTimeMillis: Effect.sync(now),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: nanos,
    monotonicTimeNanos: Effect.sync(nanos),
    sleep: (d) => Effect.suspend(() => until(now() + Duration.toMillis(d))),
  };
}

/** The frame each Live came from, for the line about one whose handling failed. */
const FRAME: Record<Live["_tag"], string> = { Open: "open", Ready: "ready", Message: "msg", Presence: "eph", Info: "info", Roster: "roster", Request: "request", Down: "status", Skipped: "status" };
const failedFrame = (frame: string, err: unknown) => `dropped a ${frame} frame whose handling failed: ${reason(err)}`;

/** What went wrong, in words: a relay out of reach says what fetch said, as it always has. */
export function reason(err: unknown): string {
  const e = err instanceof Unreachable ? err.cause : err;
  return e instanceof Error ? e.message : String(e);
}

/** The line a listener's status gets for `ev`, if any: back after an outage, the relay out of reach, a frame dropped. */
export function statusLine(ev: Live): string | null {
  switch (ev._tag) {
    case "Open":
      return ev.outage !== null ? `reconnected after ${Math.round(ev.outage / 1000)}s; nothing was missed` : null;
    case "Down":
      return `can't reach the relay for ${Math.round(ev.after / 1000)}s (${ev.code}${ev.reason ? ` ${ev.reason}` : ""}); still retrying`;
    case "Skipped":
      return failedFrame(ev.frame, ev.error);
    default:
      return null;
  }
}

/**
 * Hand each Live to `handle`, strictly in order, its status line (if any) to `status` first. A
 * handler that fails loses that one frame, said on `status`, never the stream; stopping waits for
 * the frame in hand, rather than leaving its handler half done.
 */
export const eachLive = <E, R, R2>(live: Stream.Stream<Live, E, R>, handle: (ev: Live) => Effect.Effect<void, unknown, R2>, status: (line: string) => Effect.Effect<void, never, R2>) =>
  Stream.runForEach(live, (ev) => {
    const line = statusLine(ev);
    return (line === null ? handle(ev) : Effect.andThen(status(line), handle(ev))).pipe(
      Effect.catchCause((cause) => status(failedFrame(FRAME[ev._tag], Cause.squash(cause)))),
      Effect.uninterruptible,
    );
  });

// ---------- keys and owners ----------

const keyInfo = (room: string, e: number | string) => `mc/key\n${room}\n${e}`;
const requestInfo = (room: string) => `mc/request\n${room}`;

export interface Info {
  ownerPk: string;
  ownerXpk: string;
  ownerSig: string;
  /** Owner's separate promise that titles are signed. Absent on older rooms; a relay can omit it. */
  titlesSig?: string | null;
  epoch: number;
  rotate: boolean;
  /** The channel's name, sealed with the epoch-0 key. New rooms sign it; older ones may be a plain `{ name }`. */
  title?: { iv: string; ct: string } | null;
  /** The owner's name from sign-in, vouched by the relay (null without sign-in). */
  ownerName?: string | null;
  /** When the channel's icon last changed (null: never set): refetch icon() when this moves. */
  iconAt?: number | null;
  /** The channel's settings (its mode), sealed with the epoch-0 key and signed by the owner. */
  settings?: { iv: string; ct: string } | null;
}

/** The channel's mode as the owner last signed it, and the log position it took effect at. */
/** A room as the settings list it: its id and its name. */
export interface RoomEntry {
  id: string;
  name: string;
}

/** The room list as it stood after log position `since` (general included only if renamed). */
export interface RoomsSetting {
  list: RoomEntry[];
  since: number;
}

export interface ModeSetting {
  coordinatorOnly: boolean;
  strict: boolean;
  since: number;
}

/**
 * Check the owner's signature over its own keys. Channels made by this version
 * sign a second promise into it (v: 2): every channel key the owner hands out
 * carries its signature. The relay can't fake or strip that promise, so a
 * member of such a channel never accepts a key the owner didn't sign.
 * This statement stays exactly that shape, so a 0.7 client can still join a
 * newer room. The titles promise is a separate signature (see titlesSigned).
 */
export async function ownerStatement(roomId: string, info: { ownerPk: string; ownerXpk: string; ownerSig: string }): Promise<"signed-keys" | "legacy" | null> {
  if (await verify({ room: roomId, pk: info.ownerPk, xpk: info.ownerXpk, v: 2, sig: info.ownerSig })) return "signed-keys";
  if (await verify({ room: roomId, pk: info.ownerPk, xpk: info.ownerXpk, sig: info.ownerSig })) return "legacy";
  return null;
}

/**
 * Whether this room's owner signed that its titles are owner-signed. Kept out
 * of the key statement so older clients ignore it. A relay can strip it, which
 * drops the room back to the older rule until a signed title has been seen.
 */
export async function titlesSigned(roomId: string, ownerPk: string, titlesSig: string | null | undefined): Promise<boolean> {
  if (!titlesSig) return false;
  return verify({ room: roomId, pk: ownerPk, titles: "signed", sig: titlesSig });
}

/** Fetch a room's public info and check it against the owner pinned in the join code. */
const pinnedInfo = Effect.fn("Channel.pinnedInfo")(function* (relay: string, code: string) {
  const { roomId, ownerFp } = decodeJoinCode(code);
  // Proving we hold the code (its fingerprint half) is what gets the owner's name, and keeps a bare room id from being a join code.
  const info = yield* callRelay<Info>(relay, roomId, "/info", {}, { fp: ownerFp });
  if ((yield* Effect.promise(() => ownerFingerprint(info.ownerPk))) !== ownerFp) throw new Error("this relay is serving a different owner than the join code names; refusing");
  const statement = yield* Effect.promise(() => ownerStatement(roomId, info));
  if (!statement) throw new Error("the channel owner's keys aren't signed; refusing");
  return { roomId, info, signedKeys: statement === "signed-keys" };
});

const keyStatement = (room: string, e: number | string, memberPk: string, box: string) => `kiwi-key\n${room}\n${e}\n${memberPk}\n${box}`;

/** Wrap a channel key for one member, signed by the owner so the member knows it came from them. */
async function wrapFor(owner: Identity, roomId: string, e: number | string, memberPk: string, memberXpk: string, key: string): Promise<string> {
  const box = await sealTo(memberXpk, key, keyInfo(roomId, e));
  return JSON.stringify({ box, sig: await signText(owner, keyStatement(roomId, e, memberPk, box)) });
}

/** Wrap every key this owner holds for one member. */
async function wrapAllFor(owner: Identity, roomId: string, keys: Record<string, string>, memberPk: string, memberXpk: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [e, k] of Object.entries(keys)) out[e] = await wrapFor(owner, roomId, e, memberPk, memberXpk, k);
  return out;
}

/** Unwrap this member's keys, keeping only ones the owner signed (or, on older channels, unsigned ones). */
async function unwrapKeys(id: Identity, roomId: string, wrapped: Record<string, string>, ownerPk: string, signedOnly: boolean): Promise<Record<string, string>> {
  if (!id.xsk) throw new Error("identity has no exchange key");
  const out: Record<string, string> = {};
  for (const [e, w] of Object.entries(wrapped)) {
    let box = w;
    if (w.startsWith("{")) {
      try {
        const parsed = JSON.parse(w) as { box?: unknown; sig?: unknown };
        if (typeof parsed.box !== "string" || typeof parsed.sig !== "string") continue;
        if (!(await verifyText(ownerPk, parsed.sig, keyStatement(roomId, e, id.pk, parsed.box)))) continue;
        box = parsed.box;
      } catch {
        continue;
      }
    } else if (signedOnly) continue;
    const k = await openFrom(id.xsk, box, keyInfo(roomId, e));
    if (k) out[e] = k;
  }
  return out;
}

/** Where a join request stands, as joinStatus answers it. */
export type JoinStatus =
  | { status: "pending"; sponsored: boolean; code: string | null }
  | { status: "denied"; sponsored: boolean }
  | { status: "approved"; sponsored: boolean; access: ChannelAccess };

/** A member list entry as the relay sends it. */
type MemberRow = { pk: string; xpk: string; rec: string; e: number; active: number; read_only?: number };

/** A pending join request as the relay sends it. */
type RequestRow = {
  id: string;
  pk: string;
  xpk: string;
  box: string;
  ts: number;
  commit: string;
  ownerNonce: string | null;
  reveal: string | null;
  sig: string;
  kind?: string;
  sponsorUser?: string | null;
  sponsorName?: string | null;
  sponsorEmail?: string | null;
};

/**
 * Every Channel operation as an Effect: the Promise methods run these. Same
 * arguments and results; failures typed. Local refusals (not the owner, a bad
 * name, a key that's missing) are tagged too (refusals.ts), with the texts they
 * always had; a Promise caller still gets an Error with that message.
 */
export interface ChannelFx {
  refreshKeys(): Effect.Effect<void, MemberRefusal, Relay>;
  info(fp?: string): Effect.Effect<Info, Refusal, Relay>;
  title(): Effect.Effect<string | null, Refusal, Relay>;
  setTitle(name: string): Effect.Effect<void, Refused, Relay>;
  mode(): Effect.Effect<ModeSetting | null, Refusal, Relay>;
  rooms(): Effect.Effect<RoomsSetting | null, Refusal, Relay>;
  setMode(mode: ModeSetting): Effect.Effect<void, Refused, Relay>;
  setRooms(rooms: RoomsSetting): Effect.Effect<void, Refused, Relay>;
  guard(): Effect.Effect<GuardFloor | null, Refusal, Relay>;
  setCharter(charter: NonNullable<GuardFloor["charter"]>): Effect.Effect<void, Refused, Relay>;
  setHold(hold: NonNullable<GuardFloor["hold"]>): Effect.Effect<void, Refused, Relay>;
  icon(): Effect.Effect<ChannelIcon | null, MemberRefusal, Relay>;
  setIcon(icon: ChannelIcon | null): Effect.Effect<void, Refused, Relay>;
  members(): Effect.Effect<Member[], MemberRefusal, Relay>;
  leave(): Effect.Effect<void, MemberRefusal, Relay>;
  requests(opts?: { budget?: SigningBudget }): Effect.Effect<JoinRequest[], Refused, Relay>;
  checkRequest(req: Pick<JoinRequest, "id" | "pk" | "commit">): Effect.Effect<void, Refused, Relay>;
  approve(req: JoinRequest, as?: Partial<MemberInfo>): Effect.Effect<Member, Refused, Relay>;
  reclaim(req: JoinRequest, opts: { online: boolean; force?: boolean; scopes?: Scope[] }): Effect.Effect<Member, Refused, Relay>;
  deny(requestId: string): Effect.Effect<void, Refused, Relay>;
  setCanPost(pk: string, post: boolean): Effect.Effect<void, Refused, Relay>;
  updateScopes(m: Member, scopes: readonly Scope[], since: number): Effect.Effect<void, Refused, Relay>;
  updateRole(m: Member, role: string | null, about: string | null | undefined, since: number): Effect.Effect<void, Refused, Relay>;
  reconcilePosting(state: Pick<ChannelState, "members" | "scopeSets" | "roleSets">, members?: Member[]): Effect.Effect<string[], Refused, Relay>;
  remove(pk: string): Effect.Effect<void, Refused, Relay>;
  rotate(): Effect.Effect<number, Refused, Relay>;
  rotateIfDue(): Effect.Effect<boolean, Refused, Relay>;
  close(): Effect.Effect<void, Refused, Relay>;
  head(): Effect.Effect<number, MemberRefusal, Relay>;
  send(body: string, opts?: SendOptions): Effect.Effect<number, Refused, Relay>;
  decrypt(env: Envelope): Effect.Effect<Message | null, never, Relay>;
  history(since: number): Effect.Effect<{ head: number; messages: Message[] }, MemberRefusal, Relay>;
  /**
   * The channel live, from after `since`: replays anything missed, reconnects with backoff, and
   * resumes from the last message handed on, so nothing is lost across drops. Fails ChannelGone
   * when this member is removed or the channel closed; interrupting it closes the socket.
   */
  live(since: number, opts?: LiveOptions): Stream.Stream<Live, ChannelGone, Relay>;
  /** live(), handed to StreamOptions' callbacks as stream() always has (`signal` is the Promise's; interrupt this instead). */
  stream(since: number, onMessage: (m: Message) => void | Promise<void>, opts?: StreamOptions): Effect.Effect<void, ChannelGone, Relay>;
}

export class Channel {
  readonly name: string;
  /** The key fetch in flight, shared by everyone who needs it meanwhile. */
  private refreshing: Fiber.Fiber<void, MemberRefusal> | null = null;

  constructor(
    public access: ChannelAccess,
    readonly relay: string,
    /** Signs every request and message. */
    readonly identity: Identity,
    /** Called whenever keys change (e.g. after a rotation) so callers can persist them. */
    private readonly onAccess?: (a: ChannelAccess) => void,
    /** The signed-in human behind this member (the dashboard), for owner actions on sign-in relays. */
    private readonly human?: HumanSession,
  ) {
    this.name = identity.name;
  }

  get roomId(): string {
    return this.access.roomId;
  }

  get isOwner(): boolean {
    return this.identity.pk === this.access.ownerPk;
  }

  /** A member route, signed by this member (and the owner's person, on sign-in relays). "You're out" comes back as ChannelGone. */
  private request<T>(path: string, init: CallInit = {}, params: Record<string, string | number> = {}): Effect.Effect<T, MemberRefusal, Relay> {
    return Effect.gen({ self: this }, function* () {
      const session = this.human;
      const human = session && this.isOwner ? yield* Effect.promise(() => session()) : null;
      return yield* callRelay<T>(this.relay, this.roomId, path, { ...init, identity: this.identity, human }, params);
    }).pipe(Effect.mapError(gone));
  }

  private ownerOnly(): Effect.Effect<void, OwnerOnly> {
    return this.isOwner ? Effect.void : Effect.fail(new OwnerOnly("only the channel owner can do that"));
  }

  // ---------- the operations, as Effects ----------

  static readonly fx = {
    /**
     * Create a channel owned by `owner` (the human), with `agent` (the creating
     * agent) admitted alongside. Returns the join code and the owner's access.
     */
    create: Effect.fn("Channel.create")(function* (
      relay: string,
      owner: Identity,
      ownerInfo: MemberInfo,
      agents: (Identity & { info: MemberInfo })[] = [],
      roomId: string = newRoomId(),
      human?: string | null,
      /** A name for the channel; sealed, so only members can read it. */
      title?: string,
    ) {
      if (!owner.xpk) return yield* new MissingKey("owner identity has no exchange key");
      const xpk = owner.xpk;
      const key = newChannelKey();
      const ownerSig = yield* Effect.promise(() => sign(owner, { room: roomId, xpk, v: 2 }));
      const titlesSig = yield* Effect.promise(() => sign(owner, { room: roomId, titles: "signed" }));
      const enroll = async (id: Identity, info: MemberInfo, isOwner: boolean) => ({
        pk: id.pk,
        xpk: id.xpk!,
        rec: await sealRecord(key, await makeRecord(owner, roomId, { ...info, pk: id.pk, xpk: id.xpk!, owner: isOwner })),
        keys: { "0": await wrapFor(owner, roomId, 0, id.pk, id.xpk!, key) },
        // Read-only from the start: the relay refuses their posts from the first one.
        ...(!isOwner && !canPost(scopesOf(info)) ? { post: false } : {}),
      });
      const members = yield* Effect.promise(async () => [await enroll(owner, ownerInfo, true), ...(await Promise.all(agents.map((a) => enroll(a, a.info, false))))]);
      const sealedTitle = title ? yield* Effect.promise(async () => seal(key, roomId, await sign(owner, { what: "channel-title", room: roomId, name: title.slice(0, 80) }))) : undefined;
      yield* callRelay(relay, roomId, "/create", {
        method: "POST",
        identity: owner,
        human,
        body: JSON.stringify({ owner: { pk: owner.pk, xpk, sig: ownerSig.sig, titlesSig: titlesSig.sig }, members, ...(sealedTitle ? { title: sealedTitle } : {}) }),
      });
      const access: ChannelAccess = { roomId, ownerPk: owner.pk, ownerXpk: xpk, epoch: 0, keys: { "0": key }, signedKeys: true };
      return { code: encodeJoinCode({ roomId, ownerFp: yield* Effect.promise(() => ownerFingerprint(owner.pk)) }), access };
    }),

    /**
     * Ask to join. Name and role are sealed to the owner, so the relay can't read
     * them. The request commits to this key's half of the code check (sas.ts);
     * the code itself appears in joinStatus once the owner has signed its half.
     * Asking again with the same key resumes the same request.
     */
    requestJoin: Effect.fn("Channel.requestJoin")(function* (
      relay: string,
      code: string,
      id: Identity,
      info: MemberInfo,
      /** A signed-in person joining as themself; agents leave this out. */
      human?: string | null,
      /** An agent on a computer its person linked: the computer's vouch for this key. */
      machine?: { pk: string; sig: string } | null,
    ) {
      const { roomId, info: room } = yield* pinnedInfo(relay, code);
      if (!id.xpk) return yield* new MissingKey("identity has no exchange key");
      const xpk = id.xpk;
      // The computer's vouch rides in the sealed box too, so the owner can check it against their own
      // computers without taking the relay's word for who vouched (see autoAdmissible).
      const box = yield* Effect.promise(() => sealTo(room.ownerXpk, JSON.stringify(machine ? { ...info, vouch: machine } : info), requestInfo(roomId)));
      const commit = yield* Effect.promise(async () => commitTo(roomId, id.pk, await joinNonce(id, roomId)));
      const body = yield* Effect.promise(() => sign(id, { room: roomId, xpk, box, ts: Date.now(), commit }));
      const { id: requestId } = yield* callRelay<{ id: string }>(relay, roomId, "/requests", { method: "POST", human, body: JSON.stringify(machine ? { ...body, machine } : body) });
      return { roomId, requestId };
    }),

    /** Check a join request. Once approved, returns this member's access. */
    joinStatus: Effect.fn("Channel.joinStatus")(function* (relay: string, code: string, id: Identity, requestId: string): Effect.fn.Return<JoinStatus, Refusal, Relay> {
      const { roomId, info, signedKeys } = yield* pinnedInfo(relay, code);
      const r = yield* callRelay<{ status: string; sponsored?: boolean; ownerNonce?: string | null; revealed?: boolean; epoch?: number; keys?: Record<string, string> }>(
        relay,
        roomId,
        `/requests/${requestId}`,
        { identity: id },
      );
      const sponsored = !!r.sponsored;
      if (r.status === "denied") return { status: "denied", sponsored };
      if (r.status !== "approved") {
        // The code exists once the owner has signed its half; then this side reveals its own.
        const ownerNonce = r.ownerNonce;
        if (!ownerNonce) return { status: "pending", sponsored, code: null };
        const nonce = yield* Effect.promise(() => joinNonce(id, roomId));
        if (!(yield* Effect.promise(async () => verifyText(info.ownerPk, ownerNonce, ownerNonceStatement(roomId, id.pk, await commitTo(roomId, id.pk, nonce)))))) {
          throw new Error("the relay passed on an owner signature that doesn't check out: don't let the owner approve this request, and tell them");
        }
        if (!r.revealed) yield* callRelay(relay, roomId, `/requests/${requestId}/reveal`, { method: "POST", identity: id, body: JSON.stringify({ nonce }) });
        return { status: "pending", sponsored, code: yield* Effect.promise(() => joinCheckCode(roomId, id.pk, ownerNonce, nonce)) };
      }
      const keys = yield* Effect.promise(() => unwrapKeys(id, roomId, r.keys ?? {}, info.ownerPk, signedKeys));
      return { status: "approved", sponsored, access: { roomId, ownerPk: info.ownerPk, ownerXpk: info.ownerXpk, epoch: r.epoch ?? 0, keys, signedKeys } };
    }),

    /**
     * This key's access to a channel it's already a member of (re-running join with
     * the same key, e.g. after the config was lost): nothing new is granted.
     * Fails with a RelayError 403 when the key isn't a member.
     */
    resume: Effect.fn("Channel.resume")(function* (relay: string, code: string, id: Identity) {
      const { roomId, info, signedKeys } = yield* pinnedInfo(relay, code);
      const r = yield* callRelay<{ epoch: number; keys: Record<string, string> }>(relay, roomId, "/keys", { identity: id });
      const keys = yield* Effect.promise(() => unwrapKeys(id, roomId, r.keys, info.ownerPk, signedKeys));
      const access: ChannelAccess = { roomId, ownerPk: info.ownerPk, ownerXpk: info.ownerXpk, epoch: r.epoch, keys, signedKeys };
      return access;
    }),
  };

  readonly fx: ChannelFx = {
    refreshKeys: Effect.fn("Channel.refreshKeys")({ self: this }, function* (this: Channel) {
      // One fetch however many ask at once. It runs on its own, so a caller that stops waiting doesn't stop it for the rest.
      let shared = this.refreshing;
      if (!shared) {
        const fiber = yield* Effect.forkDetach(this.fetchKeys());
        shared = this.refreshing = fiber;
        fiber.addObserver(() => {
          if (this.refreshing === fiber) this.refreshing = null;
        });
      }
      return yield* Fiber.join(shared);
    }),

    info: Effect.fn("Channel.info")({ self: this }, function* (this: Channel, fp?: string) {
      const ownerPk = this.access.ownerPk;
      const proof = fp ?? (ownerPk ? yield* Effect.promise(() => ownerFingerprint(ownerPk)) : undefined);
      return yield* callRelay<Info>(this.relay, this.roomId, "/info", {}, proof ? { fp: proof } : {});
    }),

    title: Effect.fn("Channel.title")({ self: this }, function* (this: Channel) {
      const info = yield* this.fx.info();
      const t = info.title;
      const key = this.access.keys["0"];
      if (!t || !key) return null;
      const opened = (yield* Effect.promise(() => open(key, this.roomId, t.iv, t.ct).catch(() => null))) as { what?: unknown; room?: unknown; name?: unknown; pk?: string; sig?: string } | null;
      if (!opened || typeof opened.name !== "string") return null;
      const name = opened.name.slice(0, 80);
      if (!name) return null;
      const ownerSigned = opened.what === "channel-title" && opened.room === this.roomId && opened.pk === this.access.ownerPk && (yield* Effect.promise(() => verify(opened)));
      if (ownerSigned) {
        this.noteSignedTitle();
        return name;
      }
      // Anything beyond a plain { name } is a member's forgery, not an old title.
      if (opened.what !== undefined || opened.room !== undefined || opened.pk !== undefined || opened.sig !== undefined) return null;
      if ((yield* Effect.promise(() => titlesSigned(this.roomId, info.ownerPk, info.titlesSig))) || this.access.signedTitle) return null;
      return name;
    }),

    setTitle: Effect.fn("Channel.setTitle")({ self: this }, function* (this: Channel, name: string) {
      yield* this.ownerOnly();
      const title = name.trim().slice(0, 80);
      if (!title) return yield* new Rejected("a channel title can't be empty");
      const key = this.access.keys["0"];
      if (!key) return yield* new MissingKey("missing the channel key");
      const sealed = yield* Effect.promise(async () => seal(key, this.roomId, await sign(this.identity, { what: "channel-title", room: this.roomId, name: title })));
      yield* this.request("/title", { method: "PUT", body: JSON.stringify({ title: sealed }) });
      this.noteSignedTitle();
    }),

    mode: Effect.fn("Channel.mode")({ self: this }, function* (this: Channel) {
      const o = yield* this.settings();
      if (!o || typeof o.coordinatorOnly !== "boolean" || typeof o.strict !== "boolean" || !Number.isInteger(o.since)) return null;
      const mode: ModeSetting = { coordinatorOnly: o.coordinatorOnly, strict: o.coordinatorOnly && o.strict, since: o.since as number };
      return mode;
    }),

    rooms: Effect.fn("Channel.rooms")({ self: this }, function* (this: Channel) {
      const r = (yield* this.settings())?.rooms as Partial<RoomsSetting> | undefined;
      if (!r || !Array.isArray(r.list) || !Number.isInteger(r.since)) return null;
      const list = r.list.filter((x): x is RoomEntry => !!x && typeof x === "object" && ROOM_ID_RE.test((x as RoomEntry).id) && typeof (x as RoomEntry).name === "string");
      const rooms: RoomsSetting = { list: list.map((x) => ({ id: x.id, name: x.name.slice(0, MAX_ROOM_NAME) })), since: r.since! };
      return rooms;
    }),

    setMode: Effect.fn("Channel.setMode")({ self: this }, function* (this: Channel, mode: ModeSetting) {
      const { coordinatorOnly, strict, since } = mode;
      yield* this.putSettings({ coordinatorOnly, strict, since });
    }),

    setRooms: Effect.fn("Channel.setRooms")({ self: this }, function* (this: Channel, rooms: RoomsSetting) {
      yield* this.putSettings({ rooms });
    }),

    /**
     * The charter and the hold the owner last signed into the channel's settings, each as of the event
     * at its `since`: the floor for a client holding only the log's tail, where those events may be gone.
     */
    guard: Effect.fn("Channel.guard")({ self: this }, function* (this: Channel) {
      const o = yield* this.settings();
      if (!o) return null;
      const c = o.charter as { text?: unknown; since?: unknown } | undefined;
      const h = o.hold as { on?: unknown; note?: unknown; since?: unknown } | undefined;
      const charter = c && (c.text === null || typeof c.text === "string") && Number.isInteger(c.since) ? { text: c.text === null ? null : (c.text as string).slice(0, MAX_CHARTER), since: c.since as number } : null;
      const hold = h && typeof h.on === "boolean" && Number.isInteger(h.since) ? { on: h.on, ...(typeof h.note === "string" ? { note: h.note.slice(0, 500) } : {}), since: h.since as number } : null;
      const floor: GuardFloor | null = charter || hold ? { charter, hold } : null;
      return floor;
    }),

    /** Owner: sign the charter into the channel's settings, after the charter.set at `since`. */
    setCharter: Effect.fn("Channel.setCharter")({ self: this }, function* (this: Channel, charter: NonNullable<GuardFloor["charter"]>) {
      yield* this.putSettings({ charter });
    }),

    /** Owner: sign the hold into the channel's settings, after the hold.set at `since`. */
    setHold: Effect.fn("Channel.setHold")({ self: this }, function* (this: Channel, hold: NonNullable<GuardFloor["hold"]>) {
      yield* this.putSettings({ hold });
    }),

    icon: Effect.fn("Channel.icon")({ self: this }, function* (this: Channel) {
      const { icon } = yield* this.request<{ icon: { e: number; iv: string; ct: string } | null }>("/icon");
      if (!icon) return null;
      if (!this.access.keys[String(icon.e)]) yield* this.fx.refreshKeys();
      const key = this.access.keys[String(icon.e)];
      if (!key) return null;
      const opened = (yield* Effect.promise(() => open(key, this.roomId, icon.iv, icon.ct).catch(() => null))) as { what?: unknown; room?: unknown; icon?: unknown; pk?: string; sig?: string } | null;
      // Only an icon the owner signed, for this channel: a member holds the channel key too, and could
      // otherwise seal one of their own for a colluding relay to serve. And only a sane emoji or raster image.
      if (!opened || opened.what !== "channel-icon" || opened.room !== this.roomId || opened.pk !== this.access.ownerPk || !(yield* Effect.promise(() => verify(opened)))) return null;
      return wellFormedIcon(opened.icon) ? opened.icon : null;
    }),

    setIcon: Effect.fn("Channel.setIcon")({ self: this }, function* (this: Channel, icon: ChannelIcon | null) {
      yield* this.ownerOnly();
      if (icon !== null && !wellFormedIcon(icon)) return yield* new Rejected(`an icon is one emoji, or a png, jpg, gif or webp image of at most ${MAX_ICON_BYTES / 1024}KB`);
      const e = this.access.epoch;
      const signed = icon ? yield* Effect.promise(() => sign(this.identity, { what: "channel-icon", room: this.roomId, icon })) : null;
      const sealed = signed ? { e, ...(yield* Effect.promise(() => seal(this.access.keys[String(e)]!, this.roomId, signed))) } : null;
      yield* this.request("/icon", { method: "PUT", body: JSON.stringify({ icon: sealed }) });
    }),

    members: Effect.fn("Channel.members")({ self: this }, function* (this: Channel) {
      const { members } = yield* this.request<{ members: MemberRow[] }>("/members");
      const out: Member[] = [];
      for (const m of members) {
        if (!this.access.keys[String(m.e)]) yield* this.fx.refreshKeys();
        const key = this.access.keys[String(m.e)];
        const opened = key ? yield* Effect.promise(() => openRecord(key, m.rec, this.roomId, this.access.ownerPk, m.pk)) : null;
        // The newest record seen for this key wins: a relay can't hand back an older, broader one.
        const member = opened && newestRecord(this.roomId, opened);
        if (member) out.push({ ...member, active: !!m.active, ...(m.read_only ? { readOnly: true } : {}) });
        // A key the relay says is a member, with no record we can verify: show it, so the owner can remove it.
        else if (m.active) out.push({ name: `unverified-${m.pk.slice(0, 6)}`, pk: m.pk, xpk: m.xpk, owner: false, at: 0, active: true, unverified: true });
      }
      return out;
    }),

    leave: Effect.fn("Channel.leave")({ self: this }, function* (this: Channel) {
      yield* this.request("/members/me", { method: "DELETE" });
    }),

    requests: Effect.fn("Channel.requests")({ self: this }, function* (this: Channel, opts: { budget?: SigningBudget } = {}) {
      yield* this.ownerOnly();
      const { requests } = yield* this.request<{ requests: RequestRow[] }>("/requests", {}, { v: 2 });
      const out: JoinRequest[] = [];
      const seats = requests.length ? (yield* this.fx.members()).filter((m) => m.active && !m.unverified) : [];
      for (const r of requests) {
        if (!(yield* Effect.promise(() => verify({ room: this.roomId, pk: r.pk, xpk: r.xpk, box: r.box, ts: r.ts, commit: r.commit, sig: r.sig })))) continue;
        const raw = yield* Effect.promise(() => openFrom(this.identity.xsk!, r.box, requestInfo(this.roomId)));
        let info: MemberInfo & { vouch?: { pk?: unknown; sig?: unknown } } = { name: "?" };
        try {
          info = JSON.parse(raw ?? "{}") as typeof info;
        } catch {}
        // A computer's signature over this channel and this key: checked here, never taken from the relay.
        const v = info.vouch;
        const vouchedBy =
          v && typeof v.pk === "string" && typeof v.sig === "string" && (yield* Effect.promise(() => verifyText(v.pk as string, v.sig as string, vouchStatement(this.roomId, r.pk)).catch(() => false))) ? v.pk : null;
        // An agent asking under a name a current member has: approving would move their seat, so a person
        // checks it, never the budget. (A person is admitted under their account's handle, whatever they typed.)
        const seat = r.kind === "human" ? undefined : seats.find((m) => nameKey(m.name) === nameKey(String(info.name ?? "")));
        const reclaims = seat ? { name: seat.name, pk: seat.pk, kind: seat.kind, owner: seat.owner, ...(seat.sponsor ? { sponsor: seat.sponsor } : {}) } : undefined;
        // A half that doesn't check out means the relay tampered with the request: leave it out.
        const check = yield* this.codeCheck(r, reclaims ? undefined : opts.budget).pipe(Effect.catchCause(() => Effect.succeed(null)));
        if (!check) continue;
        // Whoever holds the join code chose these: keep them to one safe line each.
        out.push({
          name: inlineText(info.name, 40) || "?",
          role: inlineText(info.role, 60) || undefined,
          about: inlineText(info.about, 200) || undefined,
          // The relay knows (from sign-in) whether a person or an agent asked; it's not up to the requester.
          kind: r.kind === "human" ? "human" : "agent",
          id: r.id,
          pk: r.pk,
          xpk: r.xpk,
          ts: r.ts,
          commit: r.commit,
          ...check,
          sponsoredBy: r.sponsorUser ? { user: r.sponsorUser, name: inlineText(r.sponsorName, 80) || r.sponsorUser, email: r.sponsorEmail ?? null } : null,
          ...(reclaims ? { reclaims } : {}),
          ...(info.reclaim === true ? { reclaim: true } : {}),
          ...(vouchedBy ? { vouchedBy } : {}),
        });
      }
      return out;
    }),

    checkRequest: Effect.fn("Channel.checkRequest")({ self: this }, function* (this: Channel, req: Pick<JoinRequest, "id" | "pk" | "commit">) {
      yield* this.ownerOnly();
      yield* this.signHalf(req.id, ownerNonceStatement(this.roomId, req.pk, req.commit));
    }),

    approve: Effect.fn("Channel.approve")({ self: this }, function* (this: Channel, req: JoinRequest, as?: Partial<MemberInfo>) {
      yield* this.ownerOnly();
      if (req.check !== "ready" || !req.code) return yield* new Rejected(`${req.name} hasn't shown its code yet: approve once you've both seen the same 6 digits`);
      const kind = req.kind ?? "agent";
      // An agent's person, by the handle they have here if they're in this channel.
      const sponsorHandle =
        kind === "agent" && req.sponsoredBy ? (yield* this.fx.members()).find((m) => m.active && m.kind === "human" && m.sponsor?.user === req.sponsoredBy!.user)?.name : undefined;
      // A person is admitted under a handle made from their signed-in account, not one they typed, so
      // nobody can ask to join as "bob-smith". (Their browser adopts it when it learns it's in.)
      if (kind === "human" && req.sponsoredBy && !as?.name) as = { ...as, name: yield* this.freeHandle(handleFor(req.sponsoredBy.name, req.sponsoredBy.email ?? undefined)) };
      yield* this.assertNamesFree([as?.name ?? req.name]);
      const sponsor = req.sponsoredBy ? { ...req.sponsoredBy, ...(kind === "human" ? { handle: as?.name ?? req.name } : sponsorHandle ? { handle: sponsorHandle } : {}) } : undefined;
      const info: MemberInfo = {
        name: as?.name ?? req.name,
        // A requested "coordinator" isn't granted on a plain confirm: the owner names that role themselves.
        role: as?.role ?? (req.role?.trim().toLowerCase() === COORDINATOR ? undefined : req.role),
        about: as?.about ?? req.about,
        kind,
        ...(kind === "human" && req.sponsoredBy ? { display: req.sponsoredBy.name } : {}),
        ...(sponsor ? { sponsor } : {}),
        // What they may do besides read; left out, everything (as before scopes).
        ...(wireScopes(as?.scopes) ? { scopes: wireScopes(as?.scopes)! } : {}),
      };
      const current = this.access.keys[String(this.access.epoch)]!;
      const rec = yield* Effect.promise(() => makeRecord(this.identity, this.roomId, { ...info, pk: req.pk, xpk: req.xpk }));
      const keys = yield* Effect.promise(() => wrapAllFor(this.identity, this.roomId, this.access.keys, req.pk, req.xpk));
      const post = canPost(scopesOf(info));
      const sealed = yield* Effect.promise(() => sealRecord(current, rec));
      yield* this.request("/members", { method: "POST", body: JSON.stringify({ pk: req.pk, xpk: req.xpk, rec: sealed, keys, request: req.id, ...(post ? {} : { post }) }) });
      const member: Member = { pk: req.pk, xpk: req.xpk, ...info, owner: false, at: rec.at, active: true };
      return member;
    }),

    reclaim: Effect.fn("Channel.reclaim")({ self: this }, function* (this: Channel, req: JoinRequest, opts: { online: boolean; force?: boolean; scopes?: Scope[] }) {
      yield* this.ownerOnly();
      const target = req.reclaims;
      if (!target) return yield* new Rejected(`${req.name} isn't anyone's seat yet: approve it as a new member`);
      if (req.check !== "ready" || !req.code) return yield* new Rejected(`${req.name} hasn't shown its code yet: approve once you've both seen the same 6 digits`);
      const seat = (yield* this.fx.members()).find((m) => m.active && m.pk === target.pk && !m.unverified);
      if (!seat) return yield* new Rejected(`${target.name}'s seat changed since this request was read: read the requests again`);
      if (seat.owner) return yield* new Rejected("the owner's seat can't be reclaimed");
      if (seat.kind === "human") return yield* new Rejected(`${seat.name} is a person's own seat: they sign in again from their browser instead`);
      if ((req.kind ?? "agent") !== "agent") return yield* new Rejected("only an agent can reclaim an agent's seat");
      if ((req.sponsoredBy?.user ?? null) !== (seat.sponsor?.user ?? null)) {
        return yield* new Rejected(`this request comes from ${req.sponsoredBy ? `${req.sponsoredBy.name}'s computer` : "a computer nobody vouched for"}, but ${seat.name} acts for ${seat.sponsor?.name ?? "nobody"}: refused`);
      }
      if (opts.online && !opts.force) return yield* new Rejected(`${seat.name} IS ONLINE NOW with its current key: this may be someone else taking its seat. Only go on if you're sure, with force`);
      const info: MemberInfo = {
        name: seat.name,
        ...(seat.role ? { role: seat.role } : {}),
        ...(seat.about ? { about: seat.about } : {}),
        kind: "agent",
        ...(seat.sponsor ? { sponsor: seat.sponsor } : {}),
        ...(wireScopes(opts.scopes ?? seat.scopes) ? { scopes: wireScopes(opts.scopes ?? seat.scopes)! } : {}),
      };
      const current = this.access.keys[String(this.access.epoch)]!;
      const rec = yield* Effect.promise(() => makeRecord(this.identity, this.roomId, { ...info, pk: req.pk, xpk: req.xpk }));
      const keys = yield* Effect.promise(() => wrapAllFor(this.identity, this.roomId, this.access.keys, req.pk, req.xpk));
      const post = canPost(scopesOf(info));
      const sealed = yield* Effect.promise(() => sealRecord(current, rec));
      yield* this.request("/members", {
        method: "POST",
        body: JSON.stringify({ pk: req.pk, xpk: req.xpk, rec: sealed, keys, request: req.id, replaces: seat.pk, ...(post ? {} : { post }) }),
      });
      yield* this.fx.rotate();
      yield* this.fx.send(`moved ${seat.name}'s seat to a new key`, { ev: { op: "seat.reclaim", member: seat.name, from: seat.pk.slice(0, 8), to: req.pk.slice(0, 8) } });
      const member: Member = { pk: req.pk, xpk: req.xpk, ...info, owner: false, at: rec.at, active: true };
      return member;
    }),

    deny: Effect.fn("Channel.deny")({ self: this }, function* (this: Channel, requestId: string) {
      yield* this.ownerOnly();
      yield* this.request(`/requests/${requestId}/deny`, { method: "POST", body: "{}" });
    }),

    setCanPost: Effect.fn("Channel.setCanPost")({ self: this }, function* (this: Channel, pk: string, post: boolean) {
      yield* this.ownerOnly();
      yield* this.request(`/members/${pk}/post`, { method: "PUT", body: JSON.stringify({ post }) });
    }),

    updateScopes: Effect.fn("Channel.updateScopes")({ self: this }, function* (this: Channel, m: Member, scopes: readonly Scope[], since: number) {
      yield* this.ownerOnly();
      if (m.owner) return yield* new Rejected("the owner may do everything");
      const e = this.access.epoch;
      const key = this.access.keys[String(e)]!;
      const { active: _a, readOnly: _r, unverified: _u, at: _at, ...info } = m;
      const rec = yield* Effect.promise(async () => sealRecord(key, await makeRecord(this.identity, this.roomId, { ...info, later: { scopes: [...scopes], since } })));
      yield* this.request(`/members/${m.pk}/record`, { method: "PUT", body: JSON.stringify({ rec, e, post: canPost(scopes) }) });
    }),

    updateRole: Effect.fn("Channel.updateRole")({ self: this }, function* (this: Channel, m: Member, role: string | null, about: string | null | undefined, since: number) {
      yield* this.ownerOnly();
      if (m.owner) return yield* new Rejected("the owner's record isn't changed this way");
      const e = this.access.epoch;
      const key = this.access.keys[String(e)]!;
      const { active: _a, readOnly: _r, unverified: _u, at: _at, ...info } = m;
      const laterRole = { role, ...(about !== undefined ? { about } : {}), since };
      const rec = yield* Effect.promise(async () => sealRecord(key, await makeRecord(this.identity, this.roomId, { ...info, laterRole })));
      const scopes = m.later?.scopes ?? scopesOf(m);
      yield* this.request(`/members/${m.pk}/record`, { method: "PUT", body: JSON.stringify({ rec, e, post: canPost(scopes) }) });
    }),

    reconcilePosting: Effect.fn("Channel.reconcilePosting")({ self: this }, function* (this: Channel, state: Pick<ChannelState, "members" | "scopeSets" | "roleSets">, members?: Member[]) {
      yield* this.ownerOnly();
      const changed: string[] = [];
      for (let m of members ?? (yield* this.fx.members())) {
        if (!m.active || m.owner || m.unverified) continue;
        const folded = state.members.get(m.name);
        // Only the key the log knows as this name's: a key the fold hasn't seen yet keeps its record's word.
        if (!folded || folded.pk !== m.pk) continue;
        // A role.set the record doesn't say yet (its second call failed, or it predates role floors).
        const roleSet = state.roleSets.get(m.name);
        if (roleSet && (m.laterRole?.since ?? -1) < roleSet.seq) {
          yield* this.fx.updateRole(m, roleSet.role, roleSet.about, roleSet.seq);
          changed.push(m.pk);
          m = { ...m, laterRole: { role: roleSet.role, ...(roleSet.about !== undefined ? { about: roleSet.about } : {}), since: roleSet.seq } };
        }
        const set = state.scopeSets.get(m.pk);
        if (set && (m.later?.since ?? -1) < set.seq) {
          yield* this.fx.updateScopes(m, set.scopes, set.seq);
          if (!changed.includes(m.pk)) changed.push(m.pk);
          continue;
        }
        const want = canPost(folded.scopes);
        if (want === !m.readOnly) continue;
        yield* this.fx.setCanPost(m.pk, want);
        if (!changed.includes(m.pk)) changed.push(m.pk);
      }
      return changed;
    }),

    remove: Effect.fn("Channel.remove")({ self: this }, function* (this: Channel, pk: string) {
      yield* this.ownerOnly();
      yield* this.request(`/members/${pk}`, { method: "DELETE" });
      yield* this.fx.rotate();
    }),

    rotate: Effect.fn("Channel.rotate")({ self: this }, function* (this: Channel) {
      yield* this.ownerOnly();
      // The new key goes only to members whose admission the owner signed, under the exchange key in
      // that record: never to whatever list or key the relay hands back.
      const members = (yield* this.fx.members()).filter((m) => m.active && !m.unverified);
      const { epoch } = yield* this.fx.info();
      const next = epoch + 1;
      const key = newChannelKey();
      const keys = yield* Effect.promise(async () => {
        const out: Record<string, string> = {};
        for (const m of members) out[m.pk] = await wrapFor(this.identity, this.roomId, next, m.pk, m.xpk, key);
        return out;
      });
      yield* this.request("/epochs", { method: "POST", body: JSON.stringify({ epoch: next, keys }) });
      this.access = { ...this.access, epoch: next, keys: { ...this.access.keys, [String(next)]: key } };
      this.onAccess?.(this.access);
      return next;
    }),

    rotateIfDue: Effect.fn("Channel.rotateIfDue")({ self: this }, function* (this: Channel) {
      if (!this.isOwner || !(yield* this.fx.info()).rotate) return false;
      yield* this.fx.rotate();
      return true;
    }),

    close: Effect.fn("Channel.close")({ self: this }, function* (this: Channel) {
      yield* this.ownerOnly();
      yield* this.request("/", { method: "DELETE" });
    }),

    head: Effect.fn("Channel.head")({ self: this }, function* (this: Channel) {
      return (yield* this.request<{ head: number }>("/")).head;
    }),

    send: Effect.fn("Channel.send")({ self: this }, function* (this: Channel, body: string, opts: SendOptions = {}) {
      const imgs = opts.imgs?.slice(0, MAX_IMAGES);
      // The same raster list as icons. A caller that skips the file picker still cannot attach SVG.
      if (imgs?.some((i) => !isRasterMime(i.mime))) return yield* new Rejected("an image must be png, jpg, gif or webp");
      const payload: Payload = {
        v: PROTOCOL_VERSION,
        id: crypto.randomUUID(),
        from: this.name,
        ...(opts.to?.length ? { to: opts.to } : {}),
        kind: opts.kind ?? (opts.ev ? "event" : "msg"),
        body,
        ...(opts.re?.length ? { re: opts.re } : {}),
        ...(opts.ev ? { ev: opts.ev } : {}),
        ...(imgs?.length ? { imgs } : {}),
        ...(opts.room && opts.room !== GENERAL_ROOM && !opts.ev ? { room: opts.room } : {}),
        ...(opts.esc && !opts.ev ? { esc: true as const } : {}),
        ts: Date.now(),
      };
      const signed = yield* Effect.promise(() => sign(this.identity, payload));
      const post = Effect.gen({ self: this }, function* () {
        if (!this.access.keys[String(this.access.epoch)]) yield* this.fx.refreshKeys();
        const e = this.access.epoch;
        const key = this.access.keys[String(e)];
        if (!key) return yield* new MissingKey(`no key for epoch ${e}`);
        const sealed = yield* Effect.promise(() => seal(key, this.roomId, signed));
        return (yield* this.request<{ seq: number }>("/messages", { method: "POST", body: JSON.stringify({ ...sealed, e }) })).seq;
      });
      // The key rotated under us: fetch the new one and resend once.
      return yield* post.pipe(Effect.catchIf((err) => err instanceof RelayError && err.status === 409, () => Effect.andThen(this.fx.refreshKeys(), post)));
    }),

    decrypt: Effect.fn("Channel.decrypt")({ self: this }, function* (this: Channel, env: Envelope) {
      const key = yield* this.keyFor(env.e ?? 0);
      if (!key) return null;
      const p = (yield* Effect.promise(() => open(key, this.roomId, env.iv, env.ct).catch(() => null))) as unknown;
      // Anything that isn't a well-formed message is dropped here, before any client folds it.
      if (!wellFormed(p)) return null;
      // Drop anything that isn't a named raster image, including SVG, rather than the whole message.
      const imgs = Array.isArray(p.imgs) ? p.imgs.filter(rasterAttachment) : undefined;
      const message: Message = { ...p, ...(imgs?.length ? { imgs } : { imgs: undefined }), seq: env.seq, rts: env.ts, sigOk: yield* Effect.promise(() => verify(p)) };
      return message;
    }),

    history: Effect.fn("Channel.history")({ self: this }, function* (this: Channel, since: number) {
      const messages: Message[] = [];
      let head = since;
      for (;;) {
        const page = yield* this.request<{ head: number; messages: Envelope[] }>("/messages", {}, { since });
        head = page.head;
        const decrypted = yield* Effect.forEach(page.messages, (e) => this.fx.decrypt(e), { concurrency: "unbounded" });
        for (let i = 0; i < page.messages.length; i++) {
          const m = decrypted[i];
          if (m) messages.push(m);
          since = page.messages[i]!.seq;
        }
        if (!page.messages.length || since >= head) break;
      }
      return { head, messages };
    }),

    live: (since: number, opts: LiveOptions = {}) => this.live(since, opts),

    stream: Effect.fn("Channel.stream")({ self: this }, function* (this: Channel, since: number, onMessage: (m: Message) => void | Promise<void>, opts: StreamOptions = {}) {
      const handle = (ev: Live): Effect.Effect<void> => {
        switch (ev._tag) {
          case "Open":
            return Effect.sync(() => opts.onOpen?.({ presence: (p) => Effect.runPromise(ev.presence(p)) }));
          case "Ready":
            return Effect.sync(() => opts.onReady?.(ev.head));
          case "Message":
            return Effect.promise(async () => onMessage(ev.message));
          case "Presence":
            return Effect.sync(() => opts.onPresence?.(ev.presence));
          case "Info":
            return Effect.sync(() => opts.onInfo?.());
          case "Roster":
            return Effect.sync(() => opts.onRoster?.());
          case "Request":
            return Effect.sync(() => opts.onRequest?.());
          default:
            return Effect.void;
        }
      };
      const listening = eachLive(this.fx.live(since, { quietMs: opts.quietMs, presence: !!opts.onPresence }), handle, (s) => Effect.sync(() => opts.onStatus?.(s)));
      // A test's clock: the quiet window and the waits between retries follow it.
      return yield* opts.now ? Effect.provideService(listening, Clock.Clock, clockFrom(opts.now)) : listening;
    }),
  };

  // ---------- helpers behind the operations ----------

  /** This member's wrapped keys, fetched and unwrapped (refreshKeys shares one of these). */
  private fetchKeys(): Effect.Effect<void, MemberRefusal, Relay> {
    return Effect.gen({ self: this }, function* () {
      const r = yield* this.request<{ epoch: number; keys: Record<string, string> }>("/keys");
      const keys = yield* Effect.promise(() => unwrapKeys(this.identity, this.roomId, r.keys, this.access.ownerPk, !!this.access.signedKeys));
      // A key this member already holds for an epoch never changes: nobody may swap it.
      this.access = { ...this.access, epoch: r.epoch, keys: { ...keys, ...this.access.keys } };
      this.onAccess?.(this.access);
    });
  }

  /** Remember that this room's title is owner-signed, and tell whoever persists access. */
  private noteSignedTitle(): void {
    if (this.access.signedTitle) return;
    this.access = { ...this.access, signedTitle: true };
    this.onAccess?.(this.access);
  }

  /** The channel's settings, opened and checked: sealed with the epoch-0 key and signed by the owner. */
  private settings(): Effect.Effect<Record<string, unknown> | null, Refusal, Relay> {
    return Effect.gen({ self: this }, function* () {
      const s = (yield* this.fx.info()).settings;
      const key = this.access.keys["0"];
      if (!s || !key) return null;
      const o = (yield* Effect.promise(() => open(key, this.roomId, s.iv, s.ct).catch(() => null))) as ({ what?: unknown; room?: unknown; pk?: string; sig?: string } & Record<string, unknown>) | null;
      if (!o || o.what !== "channel-settings" || o.room !== this.roomId || o.pk !== this.access.ownerPk || !(yield* Effect.promise(() => verify(o as never)))) return null;
      return o;
    });
  }

  /** Owner: change some settings and keep the rest (the mode and the rooms share one signed record). */
  private putSettings(change: Record<string, unknown>): Effect.Effect<void, Refused, Relay> {
    return Effect.gen({ self: this }, function* () {
      yield* this.ownerOnly();
      const key = this.access.keys["0"];
      if (!key) return yield* new MissingKey("missing the channel key");
      const { what: _w, room: _r, pk: _p, sig: _s, ...kept } = (yield* this.settings()) ?? {};
      const sealed = yield* Effect.promise(async () => seal(key, this.roomId, await sign(this.identity, { ...kept, ...change, what: "channel-settings", room: this.roomId })));
      yield* this.request("/settings", { method: "PUT", body: JSON.stringify({ settings: sealed }) });
    });
  }

  /** Where one request's code check stands, signing the owner's half if the budget allows. */
  private codeCheck(
    r: { id: string; pk: string; commit: string; ownerNonce: string | null; reveal: string | null },
    budget?: SigningBudget,
  ): Effect.Effect<Pick<JoinRequest, "code" | "check">, MemberRefusal, Relay> {
    return Effect.gen({ self: this }, function* () {
      const statement = ownerNonceStatement(this.roomId, r.pk, r.commit);
      const served = r.ownerNonce;
      if (served && !(yield* Effect.promise(() => verifyText(this.access.ownerPk, served, statement)))) throw new Error("not the owner's signature");
      const ownerNonce = served ?? (budget && spendAuto(budget, this.roomId, r.commit) ? yield* this.signHalf(r.id, statement) : null);
      if (!ownerNonce) return { code: null, check: "unchecked" as const };
      const reveal = r.reveal;
      if (!reveal) return { code: null, check: "waiting" as const };
      if ((yield* Effect.promise(() => commitTo(this.roomId, r.pk, reveal))) !== r.commit) throw new Error("the reveal doesn't match the commit");
      return { code: yield* Effect.promise(() => joinCheckCode(this.roomId, r.pk, ownerNonce, reveal)), check: "ready" as const };
    });
  }

  private signHalf(requestId: string, statement: string): Effect.Effect<string, MemberRefusal, Relay> {
    return Effect.gen({ self: this }, function* () {
      const nonce = yield* Effect.promise(() => signText(this.identity, statement));
      yield* this.request(`/requests/${requestId}/nonce`, { method: "POST", body: JSON.stringify({ nonce }) });
      return nonce;
    });
  }

  /**
   * Refuse names that can't be admitted: invalid ones (every client would drop the record and the
   * member would read invisibly), reserved ones, and any that matches a current member's, even
   * when it only looks the same.
   */
  private assertNamesFree(names: string[]): Effect.Effect<void, Refused, Relay> {
    return Effect.gen({ self: this }, function* () {
      const taken = new Set((yield* this.fx.members()).filter((m) => m.active).map((m) => nameKey(m.name)));
      const seen = new Set<string>();
      for (const n of names) {
        if (!NAME_RE.test(n)) return yield* new BadName(`"${inlineText(n, 40)}" isn't a valid name (1-32 letters, digits, _ . or -); they need to ask again under another name`);
        if (RESERVED_NAMES.has(nameKey(n))) return yield* new BadName(`"${n}" is a reserved name; they need to ask again under another name`);
        if (taken.has(nameKey(n)) || seen.has(nameKey(n))) return yield* new BadName(`"${n}" is already someone's name in this channel; they need to ask again under another name`);
        seen.add(nameKey(n));
      }
    });
  }

  /** A handle no current member has: "jonatas-walker", or "jonatas-walker-2" if that's taken. */
  private freeHandle(base: string): Effect.Effect<string, MemberRefusal, Relay> {
    return Effect.gen({ self: this }, function* () {
      const taken = new Set((yield* this.fx.members()).filter((m) => m.active).map((m) => nameKey(m.name)));
      let name = RESERVED_NAMES.has(nameKey(base)) ? `${base}-1` : base;
      for (let i = 2; taken.has(nameKey(name)); i++) name = `${base.slice(0, 29)}-${i}`;
      return name;
    });
  }

  private keyFor(e: number): Effect.Effect<string | undefined, never, Relay> {
    return Effect.gen({ self: this }, function* () {
      if (!this.access.keys[String(e)]) yield* Effect.ignoreCause(this.fx.refreshKeys());
      return this.access.keys[String(e)];
    });
  }

  /** live(): connections one after another, each from where the last left off, fed to one queue. */
  private live(since: number, { quietMs = QUIET_DROP_MS, presence = true }: LiveOptions): Stream.Stream<Live, ChannelGone, Relay> {
    // The newest seq handed on: each (re)connect asks for what's after it, so nothing is lost across drops.
    const at = { seq: since };
    return Stream.callback<Live, ChannelGone, Relay>((out) =>
      Stream.suspend(() => this.session(at, quietMs, presence)).pipe(
        // A drop: connect again on the schedule. A connection that opens starts the schedule over.
        Stream.retry(this.reconnect(out, quietMs)),
        // The schedule never gives up on a drop; only an answer (ChannelGone) gets past it.
        Stream.catchTag("Dropped", (d) => Stream.die(d)),
        // The relay replays at most one page per connection, then closes it (4000): connect again at once.
        Stream.forever,
        Stream.runIntoQueue(out),
      ),
    );
  }

  /**
   * When to connect again after a drop. Drops are routine (relay deploys, sleep, networks): say
   * nothing unless the relay stays out of reach for the quiet window, then say it once. The
   * schedule starts over when a connection opens, so its `elapsed` is how long the relay's been away.
   */
  private reconnect(out: Queue.Queue<Live, ChannelGone | Cause.Done>, quietMs: number) {
    return backoff.pipe(
      Schedule.setInputType<Dropped | ChannelGone>(),
      // Removed or closed is an answer, not a drop.
      Schedule.while(({ input }) => input instanceof Dropped),
      Schedule.tap((meta) =>
        meta.input instanceof Dropped && outlasted(meta, quietMs) ? Queue.offer(out, { _tag: "Down", after: meta.elapsed, code: meta.input.code, reason: meta.input.reason }) : Effect.void,
      ),
      // Upgrade failures (removed, closed) look like plain drops; check before retrying.
      Schedule.tap(() => this.stillIn()),
    );
  }

  /** Fails ChannelGone if this member is out; anything else (the relay still away) isn't an answer. */
  private stillIn(): Effect.Effect<void, ChannelGone, Relay> {
    return Effect.flatMap(Effect.exit(this.fx.head()), (exit) => {
      const err = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
      return err instanceof ChannelGone ? Effect.fail(err) : Effect.void;
    });
  }

  /**
   * One connection, read: Open, then what the relay sends, strictly in order, until it closes. A
   * frame whose reading fails is reported and dropped: one bad payload mustn't stop the rest.
   */
  private session(at: { seq: number }, quietMs: number, presence: boolean): Stream.Stream<Live, Dropped | ChannelGone, Relay> {
    return Stream.callback<Incoming, Dropped | ChannelGone, Relay>((q) => this.socket(at.seq, q)).pipe(
      Stream.mapEffect((f) =>
        this.read(f, at, quietMs, presence).pipe(Effect.catchCause((cause) => Effect.succeed<Live>({ _tag: "Skipped", frame: f.t, error: Cause.squash(cause) }))),
      ),
      Stream.filter((x): x is Live => x !== null),
    );
  }

  /** A socket for what's after `since`: its frames go to `q` as they arrive, then how it closed. Closing the scope closes it. */
  private socket(since: number, q: Queue.Queue<Incoming, Dropped | ChannelGone | Cause.Done>) {
    return Effect.gen({ self: this }, function* () {
      const auth = yield* Effect.promise(() => signRequest(this.identity, this.roomId, "GET", "/ws"));
      const u = new URL(`/v1/rooms/${this.roomId}/ws`, this.relay);
      u.searchParams.set("since", String(since));
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      const { ws, closed } = yield* Effect.acquireRelease(
        Effect.sync(() => this.connect(u, auth, q)),
        ({ ws }) => Effect.sync(() => ws.close(1000, "aborted")),
      );
      yield* Effect.forkScoped(keepAlive(ws));
      const { code, reason } = yield* Effect.promise(() => closed);
      if (code === 4000) return yield* Queue.end(q);
      if (code === CLOSE_REMOVED) return yield* Queue.fail(q, new ChannelGone("removed"));
      if (code === CLOSE_CLOSED) return yield* Queue.fail(q, new ChannelGone("closed"));
      return yield* Queue.fail(q, new Dropped({ code, reason }));
    });
  }

  /** Open the socket with every handler set at once, before any event can arrive. */
  private connect(u: URL, auth: string, q: Queue.Queue<Incoming, Dropped | ChannelGone | Cause.Done>) {
    const ws = new WebSocket(u, [WS_PROTOCOL, auth]);
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.onclose = (ev) => resolve({ code: ev.code, reason: ev.reason });
    });
    ws.onerror = () => {};
    ws.onopen = () => void Queue.offerUnsafe(q, { t: "open", presence: this.presenceOn(ws) });
    ws.onmessage = (ev) => {
      let f: ServerFrame | { t: "pong" };
      try {
        f = JSON.parse(String(ev.data)) as ServerFrame | { t: "pong" };
      } catch {
        return; // not a frame: ignore it, keep listening
      }
      Queue.offerUnsafe(q, f);
      // The relay replays at most one page on connect; reconnect for the rest.
      if (f.t === "ready" && f.more) ws.close(4000, "more");
    };
    return { ws, closed };
  }

  /** Send ephemeral presence on `ws`, sealed with the current key (nothing, once it has closed). */
  private presenceOn(ws: WebSocket) {
    return (p: PresenceFields): Effect.Effect<void> =>
      Effect.gen({ self: this }, function* () {
        if (ws.readyState !== WebSocket.OPEN) return;
        const full = yield* Effect.promise(() => sign(this.identity, { v: PROTOCOL_VERSION, type: "presence", from: this.name, ts: Date.now(), ...p } as Presence));
        const e = this.access.epoch;
        const sealed = yield* Effect.promise(() => seal(this.access.keys[String(e)]!, this.roomId, { ...full, e }));
        ws.send(JSON.stringify({ t: "eph", ...sealed }));
      });
  }

  /** What one frame means to a listener (null: nothing, like a message already handed on). */
  private read(f: Incoming, at: { seq: number }, quietMs: number, presence: boolean): Effect.Effect<Live | null, never, Relay> {
    return Effect.gen({ self: this }, function* () {
      switch (f.t) {
        case "open": {
          // Back after an outage the listener was told about: say for how long. The schedule's metadata is that outage's.
          const { attempt, elapsed, start } = yield* Schedule.CurrentMetadata;
          const now = yield* Clock.currentTimeMillis;
          return { _tag: "Open", presence: f.presence, outage: attempt > 0 && elapsed >= quietMs ? now - start : null } satisfies Live;
        }
        case "msg": {
          if (f.seq <= at.seq) return null;
          const m = yield* this.fx.decrypt(f);
          at.seq = f.seq;
          return m && ({ _tag: "Message", message: m } satisfies Live);
        }
        case "eph":
          return presence ? yield* this.presenceIn(f) : null;
        case "epoch":
          yield* Effect.ignoreCause(this.fx.refreshKeys());
          return null;
        case "info":
          return { _tag: "Info" } satisfies Live;
        case "roster":
          return { _tag: "Roster" } satisfies Live;
        case "request":
          return { _tag: "Request" } satisfies Live;
        case "ready":
          return { _tag: "Ready", head: f.head } satisfies Live;
        default:
          return null;
      }
    });
  }

  /** Presence, opened: it's sealed with whichever epoch key the sender had, so try the current one, then older. */
  private presenceIn(f: { iv: string; ct: string }): Effect.Effect<Live | null> {
    return Effect.gen({ self: this }, function* () {
      for (const k of Object.values(this.access.keys).reverse()) {
        const p = (yield* Effect.promise(() => open(k, this.roomId, f.iv, f.ct))) as (Presence & { e?: number }) | null;
        if (p?.type === "presence" && typeof p.from === "string") {
          const { e: _e, ...rest } = p;
          const sigOk = yield* Effect.promise(() => verify(rest));
          // role is self-reported. Flatten it before anyone renders status, so it can't invent a line.
          const role = typeof rest.role === "string" ? inlineText(rest.role, 80) || undefined : undefined;
          return { _tag: "Presence", presence: { ...rest, ...(typeof rest.role === "string" ? { role } : {}), sigOk } } satisfies Live;
        }
      }
      return null;
    });
  }

  // ---------- the same, as Promises ----------

  /**
   * Create a channel owned by `owner` (the human), with `agent` (the creating
   * agent) admitted alongside. Returns the join code and the owner's access.
   */
  static create(
    relay: string,
    owner: Identity,
    ownerInfo: MemberInfo,
    agents: (Identity & { info: MemberInfo })[] = [],
    roomId = newRoomId(),
    human?: string | null,
    /** A name for the channel; sealed, so only members can read it. */
    title?: string,
  ): Promise<{ code: string; access: ChannelAccess }> {
    return run(Channel.fx.create(relay, owner, ownerInfo, agents, roomId, human, title));
  }

  /**
   * Ask to join. Name and role are sealed to the owner, so the relay can't read
   * them. The request commits to this key's half of the code check (sas.ts);
   * the code itself appears in joinStatus once the owner has signed its half.
   * Asking again with the same key resumes the same request.
   */
  static requestJoin(
    relay: string,
    code: string,
    id: Identity,
    info: MemberInfo,
    /** A signed-in person joining as themself; agents leave this out. */
    human?: string | null,
    /** An agent on a computer its person linked: the computer's vouch for this key. */
    machine?: { pk: string; sig: string } | null,
  ): Promise<{ roomId: string; requestId: string }> {
    return run(Channel.fx.requestJoin(relay, code, id, info, human, machine));
  }

  /** Check a join request. Once approved, returns this member's access. */
  static joinStatus(relay: string, code: string, id: Identity, requestId: string): Promise<JoinStatus> {
    return run(Channel.fx.joinStatus(relay, code, id, requestId));
  }

  /**
   * This key's access to a channel it's already a member of (re-running join with
   * the same key, e.g. after the config was lost): nothing new is granted.
   * Throws a RelayError 403 when the key isn't a member.
   */
  static resume(relay: string, code: string, id: Identity): Promise<ChannelAccess> {
    return run(Channel.fx.resume(relay, code, id));
  }

  /** Fetch this member's wrapped keys (after a rotation) and unwrap them. */
  refreshKeys(): Promise<void> {
    return run(this.fx.refreshKeys());
  }

  /**
   * The channel's public info. `fp` is the join code's fingerprint half, proof we hold the code; by
   * default it's the known owner key's. A probe that doesn't know the owner yet passes the code's.
   * (A 404 here is never read as "closed": only member routes decide that, see gone().)
   */
  info(fp?: string): Promise<Info> {
    return run(this.fx.info(fp));
  }

  /**
   * The channel's name, if a member can trust it. A new room carries a separate
   * owner signature that titles are signed, so an unsigned blob is refused.
   * An older room, or a new one whose relay stripped that signature, still
   * shows a plain `{ name }` until this client has seen a title the owner
   * signed; after that, unsigned is refused too. A title sealed by a member
   * (they hold the channel key) never shows.
   */
  title(): Promise<string | null> {
    return run(this.fx.title());
  }

  /** Owner only: rename the channel. The new name is signed and sealed, like the icon. */
  setTitle(name: string): Promise<void> {
    return run(this.fx.setTitle(name));
  }

  /**
   * The mode the owner last signed into the channel's settings: the floor for a client holding only
   * the tail of the log, where the mode.set itself may have scrolled out. Null if never set.
   */
  mode(): Promise<ModeSetting | null> {
    return run(this.fx.mode());
  }

  /**
   * The rooms the owner last signed into the channel's settings, as they stood after log position
   * `since`: the floor for a client holding only the tail, where a room.create may have scrolled out.
   */
  rooms(): Promise<RoomsSetting | null> {
    return run(this.fx.rooms());
  }

  /** Owner: sign the mode into the channel's settings, after the mode.set at log position `since`. */
  setMode(mode: ModeSetting): Promise<void> {
    return run(this.fx.setMode(mode));
  }

  /** Owner: sign the room list into the channel's settings, as it stands after the room event at `since`. */
  setRooms(rooms: RoomsSetting): Promise<void> {
    return run(this.fx.setRooms(rooms));
  }

  guard(): Promise<GuardFloor | null> {
    return run(this.fx.guard());
  }

  setCharter(charter: NonNullable<GuardFloor["charter"]>): Promise<void> {
    return run(this.fx.setCharter(charter));
  }

  setHold(hold: NonNullable<GuardFloor["hold"]>): Promise<void> {
    return run(this.fx.setHold(hold));
  }

  /** The channel's icon, if the owner set one (only members can read it). */
  icon(): Promise<ChannelIcon | null> {
    return run(this.fx.icon());
  }

  /** Owner only: set the channel's icon (null clears it), signed by the owner and sealed with the current channel key. */
  setIcon(icon: ChannelIcon | null): Promise<void> {
    return run(this.fx.setIcon(icon));
  }

  /** The verified member list. Records that fail verification are dropped. */
  members(): Promise<Member[]> {
    return run(this.fx.members());
  }

  /** Leave the channel. Access is revoked at once; the owner rotates the key. */
  leave(): Promise<void> {
    return run(this.fx.leave());
  }

  /**
   * Pending join requests, opened (only the owner can read their names). With a
   * budget, this device signs the owner's half of each new request's code check
   * on its own, up to its day's share (sas.ts); past that, checkRequest() does
   * it for one request at a person's click.
   */
  requests(opts: { budget?: SigningBudget } = {}): Promise<JoinRequest[]> {
    return run(this.fx.requests(opts));
  }

  /** Sign the owner's half of one request's code check: a person's explicit go, outside the budget. */
  checkRequest(req: Pick<JoinRequest, "id" | "pk" | "commit">): Promise<void> {
    return run(this.fx.checkRequest(req));
  }

  /** Admit a requester: sign its record, and wrap every epoch key to it. */
  approve(req: JoinRequest, as?: Partial<MemberInfo>): Promise<Member> {
    return run(this.fx.approve(req, as));
  }

  /**
   * Move a member's seat to the key in `req` (a reclaim): the same name, role,
   * rules and person, so their tasks, claims and facts carry over. One relay step
   * removes the old key and admits the new one; then the channel key rotates, and
   * the owner signs a record of it. Refused unless the person behind the request
   * is the one behind the seat, and never for the owner's or a person's own seat.
   * `online` says the old key was active in the last minutes: that takes `force`. Pass `scopes`, what
   * the seat may do now, from the fold: the owner's scope.set events name the old key, so the new
   * key's record must carry them, or a reclaim would hand back whatever the old record said.
   * Without them, the old record's scopes carry over.
   */
  reclaim(req: JoinRequest, opts: { online: boolean; force?: boolean; scopes?: Scope[] }): Promise<Member> {
    return run(this.fx.reclaim(req, opts));
  }

  deny(requestId: string): Promise<void> {
    return run(this.fx.deny(requestId));
  }

  /** Whether a member may post: the one bit of their scopes the relay enforces (the scope.set event is the record). */
  setCanPost(pk: string, post: boolean): Promise<void> {
    return run(this.fx.setCanPost(pk, post));
  }

  /**
   * Owner: after a scope.set at log position `since`, re-sign the member's record to say so (a client
   * that loads only the tail of the log learns it there) and set the relay's "can post" bit, in one
   * request. The record keeps what it said at approval; `later` is what holds from `since` on.
   */
  updateScopes(m: Member, scopes: readonly Scope[], since: number): Promise<void> {
    return run(this.fx.updateScopes(m, scopes, since));
  }

  /**
   * Owner: after a role.set at log position `since`, re-sign the member's record with that role (and
   * rules), so a client holding only the tail of the log still knows it. Everything else the record
   * says, scopes included, stays as it was.
   */
  updateRole(m: Member, role: string | null, about: string | null | undefined, since: number): Promise<void> {
    return run(this.fx.updateRole(m, role, about, since));
  }

  /**
   * Owner: make each member's record and the relay's "can post" bit match the log. A scope.set lands
   * first and the record (with the bit) follows in a second call; if that one failed, or the bit was
   * changed some other way, this puts it right. Returns the keys it changed.
   */
  reconcilePosting(state: Pick<ChannelState, "members" | "scopeSets" | "roleSets">, members?: Member[]): Promise<string[]> {
    return run(this.fx.reconcilePosting(state, members));
  }

  /** Remove a member and rotate the key so they can't read anything newer. */
  remove(pk: string): Promise<void> {
    return run(this.fx.remove(pk));
  }

  /** New channel key, wrapped to every remaining member. */
  rotate(): Promise<number> {
    return run(this.fx.rotate());
  }

  /** Rotate if a member left since the last rotation. */
  rotateIfDue(): Promise<boolean> {
    return run(this.fx.rotateIfDue());
  }

  /** Delete the channel at the relay: messages, members, keys, everything. */
  close(): Promise<void> {
    return run(this.fx.close());
  }

  head(): Promise<number> {
    return run(this.fx.head());
  }

  send(body: string, opts: SendOptions = {}): Promise<number> {
    return run(this.fx.send(body, opts));
  }

  decrypt(env: Envelope): Promise<Message | null> {
    return run(this.fx.decrypt(env));
  }

  /** Messages after `since`, oldest first, following pages to the head. */
  history(since: number): Promise<{ head: number; messages: Message[] }> {
    return run(this.fx.history(since));
  }

  /**
   * Stream messages after `since` until `signal` aborts. Replays anything
   * missed, reconnects with backoff, and resumes from the last delivered seq,
   * so nothing is lost across drops. `onMessage` runs strictly in order.
   * Throws ChannelGone if this member is removed or the channel is closed.
   */
  stream(since: number, onMessage: (m: Message) => void | Promise<void>, opts: StreamOptions = {}): Promise<void> {
    return runUntil(this.fx.stream(since, onMessage, opts), opts.signal);
  }
}

/**
 * Where a client keeps the newest member record it has seen per key, across runs (the CLI's cache
 * folder, the browser's storage). Unset, it's kept for this process only.
 */
export interface RecordMemory {
  get(room: string, pk: string): Member | null;
  set(room: string, pk: string, m: Member): void;
}
const inProcess = new Map<string, Member>();
let recordMemory: RecordMemory = {
  get: (room, pk) => inProcess.get(`${room}/${pk}`) ?? null,
  set: (room, pk, m) => void inProcess.set(`${room}/${pk}`, m),
};
export function keepRecordsIn(memory: RecordMemory): void {
  recordMemory = memory;
}
/** The newer of `served` and what this client has seen for that key (by the owner-signed `at`). */
function newestRecord(room: string, served: Member): Member {
  const seen = recordMemory.get(room, served.pk);
  if (seen && seen.at > served.at) return seen;
  if (!seen || served.at > seen.at) recordMemory.set(room, served.pk, served);
  return served;
}

/** Whether a message is addressed to `agent` (directly, or as a broadcast). */
export function isForAgent(m: Message, agent: string): boolean {
  return !m.to || m.to.includes(agent) || m.to.includes("*");
}

/** Addressed to `agent` by name (not a broadcast). */
export function isDirectedAt(m: Message, agent: string): boolean {
  return !!m.to?.includes(agent);
}

export { encodeJoinCode };

/** A signed-in person's tie to a channel: they own it, are in it, and/or have agents in it. */
export interface MyChannel {
  room: string;
  code: string;
  owner: boolean;
  member: boolean;
  agents: number;
  at: number;
  /** The channel's newest seq, when the relay read it (recently active channels, newest first, up to 50). */
  head?: number;
}

/** What a signed-in person uses of a relay's limits (null limits are unlimited). */
export interface MyUsage {
  limits: { channelsPerOwner: number | null; membersPerChannel: number | null; messagesPerDay: number | null; bytesPerChannel: number; expireAfterDays: number | null };
  owned: number;
  channels: { room: string; code: string; messagesToday: number; bytes: number; members: number }[];
}

/** The Effects behind myChannels, myUsage and relayConfig. */
export const fx = {
  myChannels: Effect.fn("myChannels")(function* (relay: string, human: string) {
    const json = yield* (yield* Relay).person<{ channels?: MyChannel[] }>(relay, "/v1/me/channels", human);
    return json.channels ?? [];
  }),
  myUsage: Effect.fn("myUsage")(function* (relay: string, human: string) {
    return yield* (yield* Relay).person<MyUsage>(relay, "/v1/me/usage", human);
  }),
  relayConfig: Effect.fn("relayConfig")(function* (relay: string) {
    return yield* (yield* Relay).config(relay);
  }),
};

/** Every channel the signed-in person owns, is in, or has agents in, across all their devices. */
export function myChannels(relay: string, human: string): Promise<MyChannel[]> {
  return run(fx.myChannels(relay, human));
}

export function myUsage(relay: string, human: string): Promise<MyUsage> {
  return run(fx.myUsage(relay, human));
}

/** Whether a relay requires a signed-in human to create and run channels, and with which WorkOS client. */
export function relayConfig(relay: string): Promise<{ workosClientId: string | null }> {
  return run(fx.relayConfig(relay));
}
