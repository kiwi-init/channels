// An agent's view of one channel: the operations behind every CLI command
// and MCP tool. Keeps a local cache of the decrypted log so folding shared
// state (tasks, claims, facts, members) costs one incremental fetch.
//
// On Effect (docs/plans/effect.md, step 4). Every operation is an Effect over the
// client's own (`ch.fx`) and over this computer's files as services (Keystore,
// Cache, Cursor in config.ts), so the CLI and the MCP server run them in one
// runtime and a test can stand in for either side. What the session refuses on its
// own is a tagged Rejected (refusals.ts) carrying the text the person sees.
// `listen` follows the channel's live Stream; interrupting it closes the socket and
// stops the presence beacon with it.

import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import type * as Scoped from "effect/Scope";
import { Channel, ChannelGone, eachLive, fetchRelay, isDirectedAt, isForAgent, keepRecordsIn, QUIET_DROP_MS, reason, Relay, RelayError, settle, type Live, type Refused, type SendOptions } from "./client.ts";
import { Cache, Cursor, Keystore, LocalFiles, type ChannelConfig } from "./config.ts";
import { TOO_MANY_REQUESTS } from "./sas.ts";
import type { ChannelAccess } from "./crypto.ts";
import { inlineText, type JoinRequest, type Member } from "./membership.ts";
import type { Identity } from "./identity.ts";
import { isLocalRefusal, Rejected } from "./refusals.ts";
import { canPost, describeScopes, refusal, wireScopes, type Scope } from "./scopes.ts";
import { GENERAL_ROOM, ignored, MAX_CHARTER, TASK_STATES, type Card, type Color, type Event, type Handoff, type ImageAttachment, type Kind, type Message, type Presence, type TaskState } from "./protocol.ts";
import { allowedOnHold, claimConflict, findRoom, fold, humanOf, isPerson, keptFromPeople, newRoomId, normTags, ON_HOLD, overlaps, ownerOf, taskId, waitingOn, wouldCycle, type ChannelState, type GuardFloor, type Roster, type RoomsFloor } from "./state.ts";
import { mergeCard, sameCard } from "./card.ts";
import { cardLine } from "./format.ts";

export { Rejected };

/** How often a listening agent re-announces itself. Receivers treat 2.5x this as offline. */
export const PRESENCE_EVERY_MS = 60_000;
/** What `--to` takes for "everyone, on purpose". */
const EVERYONE = new Set(["all", "everyone", "*"]);
export const PRESENCE_TTL_MS = 150_000;

export interface Delivery {
  /** Show every message, including all coordination events. */
  all?: boolean;
  /** Every chat message, whoever it's for (what a coordinator wants). */
  chat?: boolean;
  /** Only messages addressed to this agent (by name or role, or broadcast asks). */
  forMe?: boolean;
  /** Only messages in the thread this message (root or reply) is in. */
  thread?: number;
  /** Only chat in this room (an id); events, which are channel-wide, still arrive as usual. Default: every room. */
  room?: string;
}

/** What a listener hears besides messages. */
export interface Hearing<R = never> {
  /** Who is listening, as presence says it (tail, wait, mcp…). */
  client: string;
  /** Connection trouble worth a line (the relay out of reach, back again, a frame dropped). */
  onStatus?: (line: string) => Effect.Effect<void>;
  /** Something the owner's machine should act on: a join request whose code both sides can see. */
  onNotice?: (text: string) => Effect.Effect<void, never, R>;
}

/** What a session needs: the relay, and this computer's files. */
export type Agent = Relay | Keystore | Cache | Cursor;

/** The relay over HTTP and the files in ~/.kiwi: what the CLI, the MCP server and the hooks run on. */
export const AgentLive: Layer.Layer<Agent> = Layer.mergeAll(Layer.succeed(Relay, fetchRelay), LocalFiles);

/**
 * Run a session's Effect as a Promise, on AgentLive: for callers outside Effect (tests, scripts).
 * Stopped by `signal`, it resolves, as a listener that checked `signal.aborted` did.
 */
export const runAgent = <A, E>(effect: Effect.Effect<A, E, Agent>, signal?: AbortSignal): Promise<A> =>
  Effect.runPromiseExit(Effect.provide(effect, AgentLive), { signal }).then((exit) => (signal?.aborted && Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) ? (undefined as A) : settle(exit)));

/** A refusal that's an answer, not an outage: gone, refused here, or refused by the relay for good. */
const isAnswer = (err: unknown) => err instanceof ChannelGone || isLocalRefusal(err) || (err instanceof RelayError && err.status < 500 && err.status !== 429);

const toRoster = (m: Member): Roster[number] => ({
  name: m.name,
  pk: m.pk,
  role: m.role,
  about: m.about,
  owner: m.owner,
  at: m.at,
  active: m.active,
  kind: m.kind,
  display: m.display,
  sponsor: m.sponsor,
  color: m.color,
  ...(m.scopes ? { scopes: m.scopes } : {}),
  ...(m.later ? { later: m.later } : {}),
  ...(m.laterRole ? { laterRole: m.laterRole } : {}),
});

/** A floor from the channel's settings; one that can't be read is no floor. */
const orNone = <A, E, R>(e: Effect.Effect<A | null, E, R>) => Effect.catchCause(e, () => Effect.succeed(null));

export class AgentSession {
  readonly ch: Channel;
  /** The owner's channel handle, when this machine holds the owner key. */
  readonly ownerCh: Channel | null;
  private roster: Roster | null = null;
  /** Whether the relay's can-post bits were checked against the log since the roster last changed. */
  private postingChecked = false;
  private roomsFloor: RoomsFloor | null | undefined;
  private guardFloor: GuardFloor | null | undefined;
  private roomsCheckedAt = 0;

  /** openSession makes these, with the keys loaded. */
  constructor(
    readonly alias: string,
    readonly cfg: ChannelConfig,
    readonly identity: Identity,
    owner: Identity | null,
    /** Keeps the channel's keys after a rotation. */
    persist: (a: ChannelAccess) => void,
  ) {
    this.ch = new Channel(cfg, cfg.relay, identity, persist);
    this.ownerCh = owner ? new Channel(cfg, cfg.relay, owner, persist) : null;
  }

  /** openSession, as a Promise: for callers outside Effect. */
  static open(alias: string, cfg: ChannelConfig, name: string): Promise<AgentSession> {
    return runAgent(openSession(alias, cfg, name));
  }

  get me(): string {
    return this.identity.name;
  }

  /** The verified member list (owner-signed records). */
  readonly members = Effect.fn("AgentSession.members")({ self: this }, function* (this: AgentSession, refresh = false) {
    if (!this.roster || refresh) this.roster = (yield* this.ch.fx.members()).map(toRoster);
    return this.roster;
  });

  /** Owner duty: rotate the channel key if someone left since the last rotation. */
  readonly ownerChores = Effect.fn("AgentSession.ownerChores")({ self: this }, function* (this: AgentSession) {
    const owner = this.ownerCh;
    if (!owner) return;
    if (yield* owner.fx.rotateIfDue()) yield* this.ch.fx.refreshKeys();
    // The relay's "can post" bit follows the log's scopes: check once a session, and again whenever
    // the roster changes or a scope.set's second step failed. (Not state(): it calls this.)
    if (this.postingChecked) return;
    const [messages, roster] = yield* Effect.all([this.sync(), this.members()], { concurrency: "unbounded" });
    yield* owner.fx.reconcilePosting(fold(messages, roster));
    this.postingChecked = true;
  });

  /** Pending join requests (owner machine only). */
  readonly requests = Effect.fn("AgentSession.requests")({ self: this }, function* (this: AgentSession) {
    if (!this.ownerCh) return yield* new Rejected("only the channel owner's machine can see join requests");
    return yield* this.ownerCh.fx.requests({ budget: (yield* Keystore).budget });
  });

  // ---------- log & state ----------

  /** The full log: cached messages plus anything new from the relay. */
  readonly sync = Effect.fn("AgentSession.sync")({ self: this }, function* (this: AgentSession) {
    const cache = yield* Cache;
    const cached = yield* cache.read(this.cfg.roomId);
    const last = cached.at(-1)?.seq ?? 0;
    const { messages } = yield* this.ch.fx.history(last);
    const fresh = messages.filter((m) => m.seq > last);
    yield* cache.append(this.cfg.roomId, fresh);
    return [...cached, ...fresh];
  });

  readonly state = Effect.fn("AgentSession.state")({ self: this }, function* (this: AgentSession) {
    // On the owner's machine, any command finishes a rotation owed to a member leaving.
    yield* this.ownerChores();
    const [messages, roster] = yield* Effect.all([this.sync(), this.members()], { concurrency: "unbounded" });
    return { messages, state: yield* this.foldState(messages, roster) };
  });

  /**
   * Fold with the room list the owner signed into the settings: the relay keeps only so many
   * messages, so a room's create may be gone from the log. A message in a room we don't know,
   * newer than our last look, sends us to check that list again (it may have just been made).
   */
  private foldState(messages: Message[], roster: Roster): Effect.Effect<ChannelState, never, Relay> {
    return Effect.gen({ self: this }, function* () {
      this.roomsFloor ??= yield* orNone(this.ch.fx.rooms());
      this.guardFloor ??= yield* orNone(this.ch.fx.guard());
      let state = fold(messages, roster, Date.now(), undefined, this.roomsFloor, this.guardFloor);
      const unknown = [...state.rejected].some(([seq, why]) => seq > this.roomsCheckedAt && why.startsWith("no room "));
      if (unknown) {
        this.roomsCheckedAt = state.head;
        this.roomsFloor = yield* orNone(this.ch.fx.rooms());
        state = fold(messages, roster, Date.now(), undefined, this.roomsFloor, this.guardFloor);
      }
      return state;
    });
  }

  /** A room's id from its name or id (# optional); general when none is given. */
  readonly roomId = Effect.fn("AgentSession.roomId")({ self: this }, function* (this: AgentSession, nameOrId: string | undefined, state?: ChannelState) {
    if (!nameOrId) return GENERAL_ROOM;
    const s = state ?? (yield* this.state()).state;
    const room = findRoom(s, nameOrId);
    if (!room) return yield* new Rejected(`no room ${nameOrId}: kiwi rooms lists them`);
    return room.id;
  });

  /** Owner: make a room. Its id is made here and never changes; the name can (renameRoom). */
  readonly createRoom = Effect.fn("AgentSession.createRoom")({ self: this }, function* (this: AgentSession, name: string) {
    if (!this.ownerCh) return yield* new Rejected("only the channel owner's machine makes rooms");
    const id = newRoomId();
    const state = yield* this.roomEvent(this.ownerCh, { op: "room.create", id, name }, `made the room #${name}`);
    return { id, state };
  });

  /** Owner: rename a room (general too; ids stay). */
  readonly renameRoom = Effect.fn("AgentSession.renameRoom")({ self: this }, function* (this: AgentSession, nameOrId: string, name: string) {
    if (!this.ownerCh) return yield* new Rejected("only the channel owner's machine names rooms");
    const id = yield* this.roomId(nameOrId);
    return yield* this.roomEvent(this.ownerCh, { op: "room.rename", id, name }, `renamed a room to #${name}`);
  });

  /** Send a room event as the owner, confirm it, then sign the room list into the settings as of it. */
  private roomEvent(owner: Channel, ev: Event, body: string) {
    return Effect.gen({ self: this }, function* () {
      const seq = yield* owner.fx.send(body, { kind: "event", ev });
      const state = yield* this.confirm(seq);
      const list = [...state.rooms.values()].filter((r) => r.id !== GENERAL_ROOM || r.name !== GENERAL_ROOM).map(({ id, name }) => ({ id, name }));
      yield* owner.fx.setRooms({ list, since: seq });
      this.roomsFloor = { list, since: seq };
      return state;
    });
  }

  /** The agent's read cursor, starting at the channel head the first time. */
  readonly cursor = Effect.fn("AgentSession.cursor")({ self: this }, function* (this: AgentSession) {
    const cursor = yield* Cursor;
    const c = yield* cursor.read(this.alias, this.me);
    if (c !== null) return c;
    const head = yield* this.ch.fx.head();
    yield* cursor.write(this.alias, this.me, head);
    return head;
  });

  /**
   * Whether tail/wait/read should surface `m` to this agent. Chat is shown
   * (or only chat addressed to us, with forMe); coordination events only when
   * they concern us, plus members joining. Our own messages never are.
   */
  wants(m: Message, state: ChannelState | null, d: Delivery = {}): boolean {
    return wants(this.me, m, state, d);
  }

  /** Unread messages for this agent; advances the cursor. */
  readonly read = Effect.fn("AgentSession.read")({ self: this }, function* (this: AgentSession, d: Delivery = {}) {
    const since = yield* this.cursor();
    const { messages, state } = yield* this.state();
    const cursor = yield* Cursor;
    const seen = yield* cursor.seen(this.alias, this.me);
    const unread = messages.filter((m) => m.seq > since && !seen.has(m.seq) && this.wants(m, state, d));
    yield* cursor.write(this.alias, this.me, Math.max(since, state.head));
    return { messages: unread, state };
  });

  readonly unreadCount = Effect.fn("AgentSession.unreadCount")({ self: this }, function* (this: AgentSession, state: ChannelState, messages: Message[]) {
    const cursor = yield* Cursor;
    const since = (yield* cursor.read(this.alias, this.me)) ?? state.head;
    const seen = yield* cursor.seen(this.alias, this.me);
    return messages.filter((m) => m.seq > since && !seen.has(m.seq) && this.wants(m, state)).length;
  });

  /**
   * Deliver unread and live messages to `onMessage` until interrupted, announcing presence while
   * listening. The cursor advances as each message is handled, so a restart resumes exactly where
   * this left off. A message whose handling fails is dropped with a line on onStatus, never the rest.
   *
   * An Effect that runs a handler rather than a Stream of messages: the cursor may move only once
   * the handler is done with one, which a pulled Stream can't promise.
   */
  listen<R = never>(onMessage: (m: Message, state: ChannelState) => Effect.Effect<void, unknown, R>, opts: Delivery & Hearing<R>): Effect.Effect<void, Refused | ChannelGone, Agent | R> {
    return Effect.gen({ self: this }, function* () {
      // Lets the Claude Code Stop hook know this agent can hear the channel, for as long as this process lives.
      const { registerListener } = yield* Effect.promise(() => import("./hooks.ts"));
      registerListener(this.alias, this.me);
      const status = (line: string) => opts.onStatus?.(line) ?? Effect.void;
      let { since, messages, state } = yield* this.reach(status);
      const cache = yield* Cache;
      const cursor = yield* Cursor;
      const budget = (yield* Keystore).budget;
      const seen = yield* cursor.seen(this.alias, this.me);
      const role = state.members.get(this.me)?.role;
      let lastQueryReply = 0;
      let announce: Effect.Effect<void> = Effect.void;
      let beacon: Fiber.Fiber<unknown> | null = null;
      /** In the background, for as long as this listens; its failure is nobody's business. */
      const aside = <E, R2>(e: Effect.Effect<unknown, E, R2>) => Effect.forkScoped(Effect.ignoreCause(e));

      const hear = (m: Message) =>
        Effect.gen({ self: this }, function* () {
          if (m.seq > (messages.at(-1)?.seq ?? 0)) {
            messages = [...messages, m];
            yield* cache.append(this.cfg.roomId, [m]);
            state = yield* this.foldState(messages, yield* this.members());
            // From someone we don't know yet? We may have missed a roster update while offline:
            // check again before calling it forged and moving past it for good.
            if (state.trust.get(m.seq) === "forged") state = yield* this.foldState(messages, yield* this.members(true));
          }
          if (!seen.has(m.seq) && this.wants(m, state, opts)) yield* onMessage(m, state);
          yield* cursor.write(this.alias, this.me, m.seq);
        });

      const opened = (presence: Extract<Live, { _tag: "Open" }>["presence"]) =>
        Effect.gen({ self: this }, function* () {
          // Members may have joined or left while we were disconnected.
          yield* aside(this.members(true));
          announce = Effect.ignoreCause(presence({ client: opts.client, ...(role ? { role } : {}) }));
          yield* aside(announce);
          if (beacon) yield* Fiber.interrupt(beacon);
          beacon = yield* Effect.forkScoped(Effect.forever(Effect.andThen(Effect.sleep(PRESENCE_EVERY_MS), announce)));
        });

      /** A join request becomes worth mentioning once both sides can see its code. */
      const requested = (owner: Channel, notice: (text: string) => Effect.Effect<void, never, R>) =>
        Effect.gen(function* () {
          for (const r of yield* owner.fx.requests({ budget })) {
            if (r.check === "ready") {
              yield* notice(
                `join request: "${r.name}"${r.role ? ` (${r.role})` : ""} wants in, verification code ${r.code}. ` +
                  `Only your human may approve: ask them to confirm the code matches what the joining agent shows, then run \`kiwi approve ${r.code}\` (or approve in the dashboard).`,
              );
            } else if (r.check === "unchecked") {
              yield* notice(`join request: "${r.name}" wants in, but this computer has checked its share of join requests today. ${TOO_MANY_REQUESTS}`);
            }
          }
        });

      const handle = (ev: Live): Effect.Effect<void, unknown, Agent | R | Scoped.Scope> => {
        switch (ev._tag) {
          case "Open":
            return opened(ev.presence);
          case "Message":
            return hear(ev.message);
          case "Presence":
            // Answer "who's here?" probes, at most every few seconds.
            if (!ev.presence.query || Date.now() - lastQueryReply < 3_000) return Effect.void;
            lastQueryReply = Date.now();
            return aside(announce);
          case "Roster":
            this.postingChecked = false;
            return aside(Effect.andThen(this.members(true), this.ownerChores()));
          case "Request":
            return this.ownerCh && opts.onNotice ? aside(requested(this.ownerCh, opts.onNotice)) : Effect.void;
          default:
            return Effect.void;
        }
      };
      yield* eachLive(this.ch.fx.live(since, { presence: true }), handle, status);
    }).pipe(Effect.scoped);
  }

  /**
   * Where listening starts: the cursor and the state. Starting up while the relay is briefly out of
   * reach (a deploy, a blip) waits and retries, like any drop later; past the quiet window it says so, once.
   */
  private reach(status: (line: string) => Effect.Effect<void>) {
    return Effect.gen({ self: this }, function* () {
      const start = Effect.gen({ self: this }, function* () {
        yield* this.ownerChores();
        const since = yield* this.cursor();
        return { since, ...(yield* this.state()) };
      });
      const downSince = Date.now();
      let told = false;
      for (let backoff = 500; ; backoff = Math.min(backoff * 2, 30_000)) {
        const exit = yield* Effect.exit(start);
        if (Exit.isSuccess(exit)) {
          if (told) yield* status(`reached the relay after ${Math.round((Date.now() - downSince) / 1000)}s`);
          return exit.value;
        }
        const err = Cause.squash(exit.cause);
        // Gone (removed, closed) and refusals are answers, not outages.
        if (isAnswer(err)) return yield* Effect.failCause(exit.cause);
        if (!told && Date.now() - downSince >= QUIET_DROP_MS) {
          told = true;
          yield* status(`can't reach the relay (${reason(err)}); still retrying`);
        }
        yield* Effect.sleep(backoff);
      }
    });
  }

  /** Who is listening right now: probes the channel and collects answers. */
  readonly who = Effect.fn("AgentSession.who")({ self: this }, function* (this: AgentSession, waitMs = 1_500) {
    const found = new Map<string, Presence>();
    const [head, roster] = yield* Effect.all([this.ch.fx.head(), this.members()], { concurrency: "unbounded" });
    // Answers arrive within milliseconds of the query, so stop waiting once
    // they stop coming: each new answer restarts a short quiet window. A busy
    // channel typically resolves in ~0.5s instead of the full timeout.
    const quiet = yield* Deferred.make<void>();
    let window: Fiber.Fiber<unknown> | null = null;
    const heard = Effect.gen(function* () {
      if (window) yield* Fiber.interrupt(window);
      window = yield* Effect.forkScoped(Effect.andThen(Effect.sleep(400), Deferred.succeed(quiet, undefined)));
    });
    const handle = (ev: Live) =>
      Effect.gen({ self: this }, function* () {
        if (ev._tag === "Open") return yield* Effect.ignoreCause(ev.presence({ client: "probe", query: true }));
        if (ev._tag !== "Presence") return;
        const p = ev.presence;
        if (p.client === "probe" || p.from === this.me) return;
        // Only trust presence signed by the key the owner admitted under that name.
        if (!p.sigOk || roster.find((r) => r.name === p.from && r.active)?.pk !== p.pk) return;
        if (!found.has(p.from)) yield* heard;
        const role = typeof p.role === "string" ? inlineText(p.role, 80) || undefined : undefined;
        found.set(p.from, { ...p, ...(typeof p.role === "string" ? { role } : {}) });
      });
    const probing = eachLive(this.ch.fx.live(head, { presence: true }), handle, () => Effect.void);
    yield* Effect.raceFirst(probing, Effect.raceFirst(Deferred.await(quiet), Effect.sleep(waitMs))).pipe(Effect.ignoreCause, Effect.scoped);
    return found;
  });

  // ---------- messaging ----------

  /** Expand `role:x` recipients to the members holding that role. */
  readonly resolveTo = Effect.fn("AgentSession.resolveTo")({ self: this }, function* (this: AgentSession, to: string[] | undefined, state?: ChannelState) {
    // "--to all": for everyone, on purpose. It reaches every agent; a message with no --to only reaches those following all chat.
    if (to?.some((t) => EVERYONE.has(t.toLowerCase()))) return ["*"];
    if (!to?.length || !to.some((t) => t.startsWith("role:"))) return to;
    const s = state ?? (yield* this.state()).state;
    const out = new Set<string>();
    for (const t of to) {
      if (!t.startsWith("role:")) {
        out.add(t);
        continue;
      }
      const role = t.slice(5).toLowerCase();
      for (const m of s.members.values()) if (m.role?.toLowerCase() === role) out.add(m.name);
    }
    if (!out.size) return yield* new Rejected(`no member has role ${to.filter((t) => t.startsWith("role:")).join(", ")}`);
    return [...out];
  });

  /** Send a message; `room` is a room's name or id (general if none). */
  readonly send = Effect.fn("AgentSession.send")({ self: this }, function* (this: AgentSession, body: string, opts: SendOptions = {}) {
    const to = yield* this.resolveTo(opts.to);
    yield* this.mayI({ kind: opts.kind ?? "msg", ev: opts.ev, to });
    if (opts.kind !== "event" && !opts.esc) yield* this.mayTalkTo(to);
    // A reply goes in its parent's room unless told otherwise (fold puts it there anyway).
    const parent = !opts.room && opts.re?.length ? (yield* this.state()).state.roomOf.get(opts.re[0]!) : undefined;
    const room = opts.ev ? undefined : (parent ?? (yield* this.roomId(opts.room)));
    return yield* this.ch.fx.send(body, { ...opts, to, room });
  });

  /**
   * Strict coordinator-only: refuse here a message from an agent (not the coordinator) to a person.
   * Every client would refuse it anyway, so sending it would only leave a dead message in the log.
   */
  private mayTalkTo(to: string[] | undefined) {
    return Effect.gen({ self: this }, function* () {
      if (!to?.length) return;
      const { state } = yield* this.state();
      const me = state.members.get(this.me);
      const { coordinatorOnly, strict } = state.mode;
      if (!coordinatorOnly || !strict || !state.coordinator || !me || me.kind === "human" || me.owner || this.me === state.coordinator) return;
      const people = to.filter((n) => {
        const p = state.members.get(n);
        return !!p && (p.kind === "human" || p.owner);
      });
      if (people.length) return yield* new Rejected(`this channel is coordinator-only: only ${state.coordinator} messages people. Send it to ${state.coordinator}, who passes it on.`);
    });
  }

  /**
   * Refuse here what the owner hasn't let this member send: every client would refuse it in fold
   * anyway, so sending it would only leave a dead message in the log.
   */
  private mayI(m: { kind: Kind; ev?: Event; to?: string[] }) {
    return Effect.gen({ self: this }, function* () {
      const { state } = yield* this.state();
      const me = state.members.get(this.me);
      const why = me && refusal(me.scopes, m);
      if (why) return yield* new Rejected(`the owner hasn't let you do that: you ${why} here (you may ${me.scopes.length ? describeScopes(me.scopes) : "only read"})`);
      const person = (n: string) => {
        const p = state.members.get(n);
        return !!p && isPerson(p);
      };
      if (state.hold && me && !isPerson(me) && !allowedOnHold(m, person)) {
        return yield* new Rejected(`${ON_HOLD}${state.hold.note ? ` (${state.hold.note})` : ""}. Stop work and wait; answer people if they ask you something.`);
      }
    });
  }

  /**
   * Ask a question and, with `waitSec`, block until someone answers (a reply
   * referencing it). Returns the replies; they're marked seen so tail/wait
   * don't deliver them a second time.
   */
  readonly ask = Effect.fn("AgentSession.ask")({ self: this }, function* (
    this: AgentSession,
    body: string,
    opts: { to?: string[]; kind?: Kind; waitSec?: number; imgs?: ImageAttachment[]; room?: string },
  ) {
    const head = yield* this.ch.fx.head();
    const seq = yield* this.send(body, { to: opts.to, kind: opts.kind ?? "ask", imgs: opts.imgs, room: opts.room });
    if (!opts.waitSec) return { seq, replies: [] as Message[] };
    const replies = yield* this.awaitReplies(seq, head, opts.waitSec);
    return { seq, replies };
  });

  readonly awaitReplies = Effect.fn("AgentSession.awaitReplies")({ self: this }, function* (this: AgentSession, seq: number, since: number, waitSec: number) {
    const replies: Message[] = [];
    // Only answers signed by a key the owner admitted under the sender's name count.
    let roster = yield* this.members(true);
    const genuine = (m: Message) =>
      Effect.gen({ self: this }, function* () {
        const ok = () => !!m.sigOk && !!m.pk && roster.some((r) => r.name === m.from && r.pk === m.pk);
        if (ok()) return true;
        roster = yield* this.members(true);
        return ok();
      });
    const answered = yield* Deferred.make<void>();
    const handle = (ev: Live) =>
      Effect.gen({ self: this }, function* () {
        if (ev._tag !== "Message") return;
        const m = ev.message;
        if (m.from === this.me || !m.re?.includes(seq) || !(yield* genuine(m))) return;
        replies.push(m);
        // Linger briefly so several quick answers come back together.
        if (replies.length === 1) yield* Effect.forkScoped(Effect.andThen(Effect.sleep(600), Deferred.succeed(answered, undefined)));
      });
    const listening = eachLive(this.ch.fx.live(since, { presence: false }), handle, () => Effect.void);
    yield* Effect.raceFirst(listening, Effect.raceFirst(Deferred.await(answered), Effect.sleep(waitSec * 1000))).pipe(Effect.scoped);
    yield* (yield* Cursor).markSeen(this.alias, this.me, replies.map((r) => r.seq));
    return replies;
  });

  /** Reply to message #seq, addressed to its sender, in its room (a thread lives in one). */
  readonly reply = Effect.fn("AgentSession.reply")({ self: this }, function* (this: AgentSession, seq: number, body: string, kind: Kind = "msg", imgs?: ImageAttachment[]) {
    const { messages, state } = yield* this.state();
    const orig = messages.find((m) => m.seq === seq);
    if (!orig) return yield* new Rejected(`no message #${seq}`);
    const to = orig.from === this.me ? orig.to : [orig.from];
    yield* this.mayI({ kind, to });
    yield* this.mayTalkTo(to);
    return yield* this.ch.fx.send(body, { to, kind, re: [seq], imgs, room: state.roomOf.get(seq) ?? orig.room });
  });

  /** Announce yourself. After joining, a different role or rules is a request: the owner decides. */
  readonly hello = Effect.fn("AgentSession.hello")({ self: this }, function* (this: AgentSession, role?: string, about?: string) {
    return yield* this.event({ op: "hello", role, about }, `joined${role ? ` as ${role}` : ""}`);
  });

  /**
   * Owner: set a member's role and rules, give them the role they asked for, or
   * refuse it. Sent as the owner, so every client checks it's the owner's word.
   */
  readonly decideRole = Effect.fn("AgentSession.decideRole")({ self: this }, function* (
    this: AgentSession,
    member: string,
    decision: { role: string | null; about?: string | null } | "allow" | "refuse",
  ) {
    const owner = this.ownerCh;
    if (!owner) return yield* new Rejected("only the channel owner's machine decides roles");
    const { state } = yield* this.state();
    const m = state.members.get(member);
    if (!m?.active) return yield* new Rejected(`no member named ${member}`);
    let ev: Event;
    if (decision === "refuse") ev = { op: "role.refuse", member };
    else if (decision === "allow") {
      if (!m.roleRequest) return yield* new Rejected(`${member} hasn't asked for a role`);
      ev = { op: "role.set", member, role: m.roleRequest.role ?? null, about: m.roleRequest.about ?? null };
    } else ev = { op: "role.set", member, ...decision };
    const seq = yield* owner.fx.send(ev.op === "role.refuse" ? `kept ${member}'s role` : `made ${member} ${ev.role ?? "unassigned"}`, { kind: "event", ev });
    // Then the member's record says it too, for clients holding only the log's tail. If this fails,
    // the owner's next reconcile puts it right; the role.set already counts for every client.
    if (ev.op === "role.set" && !m.owner) {
      const rec = (yield* owner.fx.members()).find((x) => x.active && x.name === member && x.pk === m.pk);
      if (rec) yield* Effect.ignoreCause(owner.fx.updateRole(rec, ev.role, ev.about, seq));
    }
    return seq;
  });

  /**
   * Owner: what a member may do besides read (null: everything). Signed by the owner key, so every
   * client checks it's the owner's word; it names the member's key, so it never carries over to
   * whoever is admitted under that name next. The relay is told the one bit it enforces itself.
   */
  readonly setScopes = Effect.fn("AgentSession.setScopes")({ self: this }, function* (this: AgentSession, member: string, scopes: Scope[] | null) {
    const owner = this.ownerCh;
    if (!owner) return yield* new Rejected("only the channel owner's machine sets what members may do");
    const { state } = yield* this.state();
    const m = state.members.get(member);
    if (!m?.active) return yield* new Rejected(`no member named ${member}`);
    if (m.owner) return yield* new Rejected("the owner may do everything");
    const wire = wireScopes(scopes);
    const ev: Event = { op: "scope.set", member, pk: m.pk, scopes: wire };
    const seq = yield* owner.fx.send(`set what ${member} may do: ${wire ? describeScopes(wire) : "full"}`, { kind: "event", ev });
    const after = yield* this.confirm(seq);
    // Then the member's record says it too (for clients holding only the log's tail), with the relay's
    // bit. If this fails, ownerChores puts both right next time.
    const rec = (yield* owner.fx.members()).find((r) => r.pk === m.pk);
    const recheck = Effect.sync(() => {
      this.postingChecked = false;
    });
    yield* rec ? owner.fx.updateScopes(rec, after.members.get(member)?.scopes ?? [], seq).pipe(Effect.catchCause(() => recheck)) : recheck;
    return after;
  });

  /**
   * Owner: coordinator-only on or off. On, people talk only with the member whose role is
   * coordinator; strict (the default) has every client refuse other agents' messages to people.
   */
  readonly setMode = Effect.fn("AgentSession.setMode")({ self: this }, function* (this: AgentSession, coordinatorOnly: boolean, strict = true) {
    const owner = this.ownerCh;
    if (!owner) return yield* new Rejected("only the channel owner's machine sets the channel's mode");
    const ev = { op: "mode.set" as const, coordinatorOnly, strict: coordinatorOnly && strict };
    const body = coordinatorOnly ? `coordinator-only on${ev.strict ? " (strict)" : ""}` : "coordinator-only off";
    const since = yield* owner.fx.send(body, { kind: "event", ev });
    // Then the channel's settings say it too, for clients holding only the log's tail.
    yield* owner.fx.setMode({ coordinatorOnly, strict: ev.strict, since });
    return yield* this.confirm(since);
  });

  /**
   * Owner: what the channel is for and where its limits are (null clears it). Every agent is shown it,
   * and told to escalate what falls outside it instead of doing it.
   */
  readonly setCharter = Effect.fn("AgentSession.setCharter")({ self: this }, function* (this: AgentSession, text: string | null) {
    const owner = this.ownerCh;
    if (!owner) return yield* new Rejected("only the channel owner's machine sets the charter");
    const clean = text?.trim() || null;
    if (clean && clean.length > MAX_CHARTER) return yield* new Rejected(`a charter is at most ${MAX_CHARTER} characters`);
    const since = yield* owner.fx.send(clean ? `charter: ${clean}` : "cleared the charter", { kind: "event", ev: { op: "charter.set", text: clean } });
    // Then the settings say it too, for clients holding only the log's tail.
    yield* owner.fx.setCharter({ text: clean, since });
    this.guardFloor = undefined;
    return yield* this.confirm(since);
  });

  /**
   * Owner: stop every agent, or let them carry on. While on hold every client refuses an agent's work
   * (tasks, claims, facts, messages to other agents); agents may still answer people.
   */
  readonly setHold = Effect.fn("AgentSession.setHold")({ self: this }, function* (this: AgentSession, on: boolean, note?: string) {
    const owner = this.ownerCh;
    if (!owner) return yield* new Rejected("only the channel owner's machine puts the channel on hold");
    const clean = note?.trim().slice(0, 500) || undefined;
    const since = yield* owner.fx.send(on ? `on hold${clean ? `: ${clean}` : ""}` : "hold lifted", { kind: "event", ev: { op: "hold.set", on, ...(clean ? { note: clean } : {}) } });
    yield* owner.fx.setHold({ on, ...(clean ? { note: clean } : {}), since });
    this.guardFloor = undefined;
    return yield* this.confirm(since);
  });

  /**
   * Hand a decision to people instead of acting: a blocking question to this agent's own human and
   * the owner, about message #re when given. It reaches them in any mode, and on hold.
   */
  readonly escalate = Effect.fn("AgentSession.escalate")({ self: this }, function* (this: AgentSession, body: string, re?: number) {
    const { messages, state } = yield* this.state();
    const me = state.members.get(this.me);
    if (me && isPerson(me)) return yield* new Rejected("escalating is for agents: you're a person, so you decide");
    if (re !== undefined && !messages.some((m) => m.seq === re)) return yield* new Rejected(`no message #${re}`);
    const to = [...new Set([humanOf(state, this.me), ownerOf(state)].filter((n): n is string => !!n))];
    if (!to.length) return yield* new Rejected("there's no person in this channel to escalate to");
    const seq = yield* this.send(body, { to, kind: "blocking", esc: true, ...(re !== undefined ? { re: [re] } : {}) });
    return { seq, to };
  });

  /**
   * A person's colour (null clears it). Signed by the person themself when it's
   * this session's own name, else by the owner key on this machine. The fold
   * refuses a colour someone else has, and colours on agents.
   */
  readonly setColor = Effect.fn("AgentSession.setColor")({ self: this }, function* (this: AgentSession, member: string, color: Color | null) {
    const ch = member === this.me ? this.ch : this.ownerCh;
    if (!ch) return yield* new Rejected("only that person, or the channel owner's machine, sets their colour");
    const ev: Event = { op: "color.set", member, color };
    if (ch === this.ch) yield* this.mayI({ kind: "event", ev });
    return yield* this.confirm(yield* ch.fx.send(color ? `${member}'s colour is ${color}` : `cleared ${member}'s colour`, { kind: "event", ev }));
  });

  // ---------- events ----------

  private event(ev: Event, body: string, to?: string[]) {
    return Effect.gen({ self: this }, function* () {
      yield* this.mayI({ kind: "event", ev });
      return yield* this.ch.fx.send(body, { kind: "event", ev, to: to?.length ? [...new Set(to)].filter((n) => n !== this.me) : undefined });
    });
  }

  /** Send an event, then confirm the fold accepted it (it may lose a race). */
  private confirm(seq: number) {
    return Effect.gen({ self: this }, function* () {
      const { state } = yield* this.state();
      const why = state.rejected.get(seq);
      if (why) return yield* new Rejected(why);
      return state;
    });
  }

  readonly taskAdd = Effect.fn("AgentSession.taskAdd")({ self: this }, function* (
    this: AgentSession,
    title: string,
    opts: { detail?: string; owner?: string; after?: number[]; needs?: string[]; review?: string } = {},
  ) {
    const { state } = yield* this.state();
    for (const d of opts.after ?? []) if (!state.tasks.has(d)) return yield* new Rejected(`no task ${taskId(d)}`);
    const owner = opts.owner && (yield* this.resolveTo([opts.owner], state))?.[0];
    const review = opts.review === undefined ? undefined : yield* this.reviewer(state, opts.review);
    const needs = normTags(opts.needs);
    return yield* this.event(
      {
        op: "task.add",
        title,
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(owner ? { owner } : {}),
        ...(opts.after?.length ? { after: opts.after } : {}),
        ...(needs.length ? { needs } : {}),
        ...(review ? { review } : {}),
      },
      `task: ${title}`,
      [...(owner ? [owner] : []), ...(review && review !== "*" ? [review] : [])],
    );
  });

  /** "any" (or "*") is anyone but the task's owner; otherwise a current member, by name or role:x. */
  private reviewer(state: ChannelState, who: string): Effect.Effect<string, Rejected> {
    const w = who.trim();
    if (w === "*" || w.toLowerCase() === "any") return Effect.succeed("*");
    const m = state.members.get(w);
    if (!m?.active) return Effect.fail(new Rejected(`no member named ${w} to review it (or say any)`));
    return Effect.succeed(w);
  }

  readonly taskClaim = Effect.fn("AgentSession.taskClaim")({ self: this }, function* (this: AgentSession, id: number) {
    const { state } = yield* this.state();
    const t = state.tasks.get(id);
    if (!t) return yield* new Rejected(`no task ${taskId(id)}`);
    if (t.state === "done") return yield* new Rejected(`${taskId(id)} is already done`);
    if (t.state === "cancelled") return yield* new Rejected(`${taskId(id)} is cancelled`);
    if (t.owner && t.owner !== this.me) return yield* new Rejected(`${taskId(id)} is owned by ${t.owner}`);
    const waits = waitingOn(state, t);
    const seq = yield* this.event({ op: "task.claim", task: id }, `claimed ${taskId(id)}`);
    const after = yield* this.confirm(seq);
    if (waits.length) return yield* new Rejected(`claimed, but ${taskId(id)} is still waiting on ${waits.map(taskId).join(", ")}`);
    return after;
  });

  readonly taskUpdate = Effect.fn("AgentSession.taskUpdate")({ self: this }, function* (
    this: AgentSession,
    id: number,
    change: { state?: TaskState; owner?: string | null; title?: string; note?: string; after?: number[]; review?: string | null; handoff?: Handoff },
  ) {
    const { state } = yield* this.state();
    const t = state.tasks.get(id);
    if (!t) return yield* new Rejected(`no task ${taskId(id)}`);
    if (change.state && !TASK_STATES.includes(change.state)) return yield* new Rejected(`state must be one of ${TASK_STATES.join(", ")}`);
    if (change.after?.length) yield* this.checkAfter(state, id, change.after);
    const owner = change.owner ? (yield* this.resolveTo([change.owner], state))?.[0] : change.owner;
    const review = change.review ? yield* this.reviewer(state, change.review) : change.review;
    // Said here rather than left to every client's fold: the doer can't mark its own reviewed work done.
    const me = state.members.get(this.me);
    const gate = review === undefined ? t.review : review || undefined;
    if (change.state === "done" && t.state !== "done" && gate && me && !isPerson(me) && (gate === "*" ? (owner ?? t.owner) === this.me || t.workedBy.includes(this.me) : gate !== this.me)) {
      return yield* new Rejected(`${taskId(id)} needs review by ${gate === "*" ? "someone who hasn't worked on it" : gate} before it's done: send it for review (kiwi task review ${taskId(id)})`);
    }
    // Tell whoever this concerns: the new owner, the current owner if it isn't
    // us, the creator when it's done or cancelled, and owners of tasks it unblocks.
    const notify: string[] = [];
    if (owner) notify.push(owner);
    if (t.owner && t.owner !== this.me) notify.push(t.owner);
    // In review: whoever must approve it hears; a named reviewer, or the one just named.
    const reviewerName = (review ?? t.review) !== "*" ? (review ?? t.review) : undefined;
    if ((change.state === "review" || review) && reviewerName) notify.push(reviewerName);
    if (change.state === "done" || change.state === "cancelled") {
      notify.push(t.createdBy);
      for (const other of state.tasks.values()) if (other.after.includes(id) && other.owner) notify.push(other.owner);
    }
    const seq = yield* this.event(
      { op: "task.update", task: id, ...change, ...(owner !== undefined ? { owner } : {}), ...(review !== undefined ? { review } : {}) },
      `${taskId(id)} ${change.handoff ? "handed over" : (change.state ?? "updated")}`,
      notify,
    );
    return yield* this.confirm(seq);
  });

  /**
   * Hand a task to someone else with where it stands: the branch and commit to pick it up from, the
   * files in play, and what's next. This agent's claims on those files are let go, so the next owner
   * can claim them.
   */
  readonly taskHandoff = Effect.fn("AgentSession.taskHandoff")({ self: this }, function* (this: AgentSession, id: number, to: string, next: string | undefined, handoff: Handoff) {
    const { state: before } = yield* this.state();
    const target = (yield* this.resolveTo([to], before))?.[0];
    if (!target || !before.members.get(target)?.active) return yield* new Rejected(`no member named ${to}`);
    if (target === this.me) return yield* new Rejected("hand it to someone else");
    const state = yield* this.taskUpdate(id, { owner: target, ...(next ? { note: next } : {}), handoff, ...(before.tasks.get(id)?.state === "doing" ? { state: "todo" as const } : {}) });
    const files = handoff.files ?? [];
    const held = state.claims.filter((c) => c.owner === this.me && files.some((f) => overlaps(c.path, f))).map((c) => c.path);
    if (held.length) yield* this.release(held);
    return state;
  });

  /**
   * Say what this agent is and has (see card.ts): what's detected here, keeping what was said by hand
   * before unless `given` says it again. Sent only when it changed; people don't carry cards.
   */
  readonly refreshCard = Effect.fn("AgentSession.refreshCard")({ self: this }, function* (
    this: AgentSession,
    detected: Card,
    given: { model?: string; note?: string; tools?: string[] } = {},
  ) {
    const { state } = yield* this.state();
    const me = state.members.get(this.me);
    const card = mergeCard(detected, me?.card, given);
    if (!me || isPerson(me) || !canPost(me.scopes) || state.hold || sameCard(me.card, card)) return { sent: false, card };
    yield* this.event({ op: "card", ...card }, `card: ${cardLine(card)}`);
    return { sent: true, card };
  });

  /** Append dependencies. Missing ids, self-deps and cycles are refused. */
  readonly taskAfter = Effect.fn("AgentSession.taskAfter")({ self: this }, function* (this: AgentSession, id: number, deps: number[]) {
    if (!deps.length) return yield* new Rejected("name at least one task to wait on");
    const { state } = yield* this.state();
    yield* this.checkAfter(state, id, deps);
    const seq = yield* this.event({ op: "task.update", task: id, after: deps }, `${taskId(id)} waits on ${deps.map(taskId).join(", ")}`);
    return yield* this.confirm(seq);
  });

  private checkAfter(state: ChannelState, id: number, deps: number[]): Effect.Effect<void, Rejected> {
    if (!state.tasks.has(id)) return Effect.fail(new Rejected(`no task ${taskId(id)}`));
    for (const d of deps) {
      if (!state.tasks.has(d)) return Effect.fail(new Rejected(`no task ${taskId(d)}`));
      if (wouldCycle(state.tasks, id, d)) return Effect.fail(new Rejected(`${taskId(id)} waiting on ${taskId(d)} would cycle`));
    }
    return Effect.void;
  }

  readonly claim = Effect.fn("AgentSession.claim")({ self: this }, function* (
    this: AgentSession,
    paths: string[],
    ttlSec: number,
    note?: string,
    place?: { machine?: string; checkout?: string },
  ) {
    const { state } = yield* this.state();
    for (const p of paths) {
      const c = state.claims.find((x) => x.owner !== this.me && overlaps(x.path, p));
      if (c) return yield* new Rejected(claimConflict(c));
    }
    const seq = yield* this.event(
      { op: "claim", paths, ttl: ttlSec, ...(note ? { note } : {}), ...(place?.machine ? { machine: place.machine } : {}), ...(place?.checkout ? { checkout: place.checkout } : {}) },
      `claimed ${paths.join(", ")}`,
    );
    return yield* this.confirm(seq);
  });

  readonly release = Effect.fn("AgentSession.release")({ self: this }, function* (this: AgentSession, paths?: string[]) {
    return yield* this.event({ op: "release", ...(paths?.length ? { paths } : {}) }, paths?.length ? `released ${paths.join(", ")}` : "released all claims");
  });

  readonly setFact = Effect.fn("AgentSession.setFact")({ self: this }, function* (this: AgentSession, key: string, value: string, ttlSec?: number) {
    return yield* this.event({ op: "fact.set", key, value, ...(ttlSec ? { ttl: ttlSec } : {}) }, `${key} = ${value}`);
  });

  readonly delFact = Effect.fn("AgentSession.delFact")({ self: this }, function* (this: AgentSession, key: string) {
    return yield* this.event({ op: "fact.del", key }, `unset ${key}`);
  });
}

/** One agent's session on one channel, with its keys (and the owner's, when this machine holds them) loaded. */
export const openSession = Effect.fn("AgentSession.open")(function* (alias: string, cfg: ChannelConfig, name: string) {
  const keys = yield* Keystore;
  // Member records: the newest this machine has seen per key wins, across runs.
  keepRecordsIn(keys.records);
  const owner = cfg.owner ? yield* keys.identity(cfg.owner, cfg.roomId) : null;
  const identity = yield* keys.identity(name, cfg.roomId);
  return new AgentSession(alias, cfg, identity, owner, (a) => Effect.runSync(keys.saveAccess(alias, a)));
});

export type { Presence };

/**
 * `AgentSession.wants`, for callers that have the state but no session (kiwi sh).
 * By default an agent gets what's for it: messages to it or its role, broadcasts
 * from people and broadcast questions, and every message in a thread it's in.
 * Other agents' conversations stay out unless it asks for all chat.
 */
export function wants(me: string, m: Message, state: ChannelState | null, d: Delivery = {}): boolean {
  if (m.from === me) return false;
  // Forged messages never reach an agent: they're noise at best, prompt injection at worst. Nor do
  // ones the owner didn't let their sender send (outside its scopes).
  if (ignored(state?.trust.get(m.seq))) return false;
  // One room only: other rooms' chat stays out; events are channel-wide.
  if (d.room !== undefined && m.kind !== "event" && (state?.roomOf.get(m.seq) ?? m.room ?? GENERAL_ROOM) !== d.room) return false;
  if (d.all) return true;
  // Any message of a thread names it: its root, or a reply in it.
  if (d.thread !== undefined) return m.kind !== "event" && (state?.threadOf.get(m.seq) ?? m.seq) === (state?.threadOf.get(d.thread) ?? d.thread);
  const role = state?.members.get(me)?.role;
  const addressed = isDirectedAt(m, me) || !!m.to?.includes("*") || (!!role && !!m.to?.includes(`role:${role}`));
  // Everyone hears when the channel's mode changes: it changes who they may talk to.
  // Everyone hears about a new or renamed room: it's somewhere they can now talk.
  // Everyone hears the charter and the hold: they change what anyone may do.
  if (m.kind === "event") return addressed || m.ev?.op === "hello" || m.ev?.op === "mode.set" || m.ev?.op === "room.create" || m.ev?.op === "room.rename" || m.ev?.op === "charter.set" || m.ev?.op === "hold.set";
  if (d.chat) return true;
  // Coordinator-only (with a coordinator in place): what people say goes to the coordinator, who
  // relays it. Another agent gets a person's message only if it's addressed to that agent by name.
  const sender = state?.members.get(m.from);
  if (state?.mode.coordinatorOnly && state.coordinator && sender && (sender.kind === "human" || sender.owner)) {
    return me === state.coordinator || isDirectedAt(m, me);
  }
  // A person reading from the CLI: in strict mode, other agents' words don't reach them at all.
  const self = state?.members.get(me);
  if (state && self && (self.kind === "human" || self.owner) && keptFromPeople(state, m)) return false;
  const asking = isForAgent(m, me) && (m.kind === "ask" || m.kind === "blocking");
  if (d.forMe) return addressed || asking;
  const fromPerson = !m.to?.length && (sender?.kind === "human" || !!sender?.owner);
  const inMyThread = !!state?.threadPeople.get(state.threadOf.get(m.seq) ?? m.seq)?.has(me);
  return addressed || asking || fromPerson || inMyThread;
}
