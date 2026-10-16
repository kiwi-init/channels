// An agent's view of one channel: the operations behind every CLI command
// and MCP tool. Keeps a local cache of the decrypted log so folding shared
// state (tasks, facts, members) costs one incremental fetch.
//
// On Effect (docs/plans/effect.md, step 4). Every operation is an Effect over the
// client's own (`ch.fx`) and over this computer's files as services (Keystore,
// Cache, Cursor in config.ts), so the CLI and the MCP server run them in one
// runtime and a test can stand in for either side. What the session refuses on its
// own is a tagged Rejected (refusals.ts) carrying the text the person sees.
// `listen` follows the channel's live Stream; interrupting it closes the socket and
// stops the presence beacon with it.

import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import type * as Scoped from "effect/Scope";
import { Channel, ChannelGone, eachLive, fetchRelay, isDirectedAt, isForAgent, keepAnswersIn, keepRecordsIn, QUIET_DROP_MS, reason, Relay, RelayError, settle, type Live, type Refused, type SendOptions } from "./client.ts";
import { Cache, Cursor, Keystore, LocalFiles, type ChannelConfig } from "./config.ts";
import { TOO_MANY_REQUESTS } from "./sas.ts";
import type { ChannelAccess } from "./crypto.ts";
import { inlineText, type Member } from "./membership.ts";
import type { Identity } from "./identity.ts";
import { isLocalRefusal, Rejected } from "./refusals.ts";
import { canPost, describeScopes, refusal } from "./scopes.ts";
import { GENERAL_ROOM, ignored, PROTOCOL_VERSION, TASK_STATES, wellFormedReaction, type Card, type Color, type Event, type ImageAttachment, type Kind, type Message, type Presence, type TaskState, type Verdict } from "./protocol.ts";
import { allowedOnHold, findRoom, fold, humanOf, isPerson, keptFromPeople, ON_HOLD, openRound, ownerOf, revisedOut, taskId, threadMembers, type ChannelState, type GuardFloor, type ReviewRound, type Roster, type RoomsFloor, type Task } from "./state.ts";
import { mergeCard, sameCard } from "./card.ts";
import { daemonSeat } from "./daemon.ts";
import { isWakeVia, viaOf } from "./wake.ts";
import { cardLine } from "./format.ts";

export { Rejected };

/** How often a listener tells the channel how far it has read, at most. */
export const MARK_EVERY_MS = 1_000;
/** How long a command that's done waits for its last read mark to land. */
const LAST_MARK_MS = 2_000;
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
  /** Connection trouble worth a line (the relay out of reach, back again, a frame dropped). */
  onStatus?: (line: string) => Effect.Effect<void>;
  /** Something the owner's machine should act on: a join request whose code both sides can see. */
  onNotice?: (text: string) => Effect.Effect<void, never, R>;
  /**
   * Tell the channel what this hands on has been read (default true). Off for a listener whose
   * handing-on isn't reading yet: the hooks' background listener (its session reads at its next turn)
   * and the MCP wait (a cancelled call gives its messages back).
   */
  marks?: boolean;
  hold?: boolean;
}

/** What a session needs: the relay, and this computer's files. */
export type Agent = Relay | Keystore | Cache | Cursor;

/** The relay over HTTP and the files in ~/.kiwi: what the CLI, the MCP server and the hooks run on. */
export const AgentLive: Layer.Layer<Agent> = Layer.mergeAll(Layer.succeed(Relay, fetchRelay), LocalFiles);

/** Run a session's Effect as a Promise, on AgentLive: for callers outside Effect (tests, scripts). */
export const runAgent = <A, E>(effect: Effect.Effect<A, E, Agent>): Promise<A> => Effect.runPromiseExit(Effect.provide(effect, AgentLive)).then(settle);

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
  ...(m.runs ? { runs: m.runs } : {}),
});

export const holding = (alias: string, as: string): Effect.Effect<void, never, Scoped.Scope> =>
  Effect.gen(function* () {
    const { holdListening } = yield* Effect.promise(() => import("./hooks.ts"));
    yield* Effect.acquireRelease(
      Effect.promise(() => holdListening(alias, as)),
      (held) => Effect.sync(() => held.close()),
    );
  });

interface Seen {
  messages: Message[];
  roster: Roster;
  rooms: RoomsFloor | null | undefined;
  guard: GuardFloor | null | undefined;
  view: { messages: Message[]; state: ChannelState };
}

interface Look {
  fetched: WeakSet<AgentSession>;
  seen: WeakMap<AgentSession, Seen>;
}

const Look = Context.Reference<Look | null>("kiwi/AgentSession/Look", { defaultValue: () => null });

export const oneLook = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.service(Look), (look) => (look ? effect : Effect.provideService(effect, Look, { fetched: new WeakSet(), seen: new WeakMap() })));

const lastSeq = (log: readonly Message[]) => log.at(-1)?.seq ?? 0;

/** A floor from the channel's settings; one that can't be read is no floor. */
const orNone = <A, E, R>(e: Effect.Effect<A | null, E, R>) => Effect.catchCause(e, () => Effect.succeed(null));

function judgedRound(t: Task, open: ReviewRound | undefined, round: number | undefined, at: string | undefined): Effect.Effect<ReviewRound, Rejected> {
  const id = taskId(t.id);
  const wanted = at?.trim() || undefined;
  if (!open) return Effect.fail(new Rejected(`${id} has no review round open`));
  if (round === undefined && wanted === undefined) return Effect.fail(new Rejected(`say which round of ${id} you reviewed: --round ${open.n}${open.at ? ` (or --at ${open.at})` : ""}`));
  const target = round !== undefined ? t.rounds.find((r) => r.n === round) : [...t.rounds].reverse().find((r) => r.at === wanted);
  if (!target) return Effect.fail(new Rejected(`${id} has no round ${round ?? `at ${wanted}`}`));
  if (target.n !== open.n) return Effect.fail(new Rejected(`round ${target.n} of ${id} isn't the open one: round ${open.n} is${open.at ? `, at ${open.at}` : ""}`));
  if (wanted !== undefined && target.at !== wanted) return Effect.fail(new Rejected(`round ${target.n} of ${id} is ${target.at ? `at ${target.at}` : "at no commit"}, not at ${wanted}`));
  return Effect.succeed(target);
}

export class AgentSession {
  readonly ch: Channel;
  private roster: Roster | null = null;
  /** Whether the relay's can-post bits were checked against the log since the roster last changed (the owner's session keeps them). */
  protected postingChecked = false;
  protected roomsFloor: RoomsFloor | null | undefined;
  protected guardFloor: GuardFloor | null | undefined;
  private roomsCheckedAt = 0;
  private log: Message[] | null = null;
  private saved = 0;
  private owed = 0;

  /** openSession makes these, with the keys loaded. */
  constructor(
    readonly alias: string,
    readonly cfg: ChannelConfig,
    readonly identity: Identity,
    /** Keeps the channel's keys after a rotation. */
    persist: (a: ChannelAccess) => void,
  ) {
    this.ch = new Channel(cfg, cfg.relay, identity, persist, { keepInfo: true });
    this.ch.onSent = (seq, m) => {
      if (m && this.log && seq === lastSeq(this.log) + 1) this.log = [...this.log, m];
      else this.owed = Math.max(this.owed, seq);
    };
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

  /** What the owner's own session finishes on every look (OwnerSession, src/owner.ts); nothing for anyone else. */
  protected chores(): Effect.Effect<void, Refused, Agent> {
    return Effect.void;
  }

  // ---------- log & state ----------

  /** The full log: cached messages plus anything new from the relay. */
  readonly sync = Effect.fn("AgentSession.sync")({ self: this }, function* (this: AgentSession) {
    const cache = yield* Cache;
    if (!this.log) {
      const cached = yield* cache.read(this.cfg.roomId);
      this.saved = Math.max(this.saved, lastSeq(cached));
      this.log ??= cached;
    }
    const look = yield* Look;
    if (!look?.fetched.has(this) || lastSeq(this.log) < this.owed) {
      const { messages } = yield* this.ch.fx.history(lastSeq(this.log));
      const last = lastSeq(this.log);
      const fresh = messages.filter((m) => m.seq > last);
      if (fresh.length) this.log = [...this.log, ...fresh];
      look?.fetched.add(this);
    }
    const log = this.log;
    const unsaved = log.filter((m) => m.seq > this.saved);
    if (unsaved.length) {
      yield* cache.append(this.cfg.roomId, unsaved);
      this.saved = Math.max(this.saved, lastSeq(unsaved));
    }
    return log;
  });

  readonly state = Effect.fn("AgentSession.state")({ self: this }, function* (this: AgentSession) {
    yield* this.chores();
    const [messages, roster] = yield* Effect.all([this.sync(), this.members()], { concurrency: "unbounded" });
    const look = yield* Look;
    const seen = look?.seen.get(this);
    if (seen && seen.messages === messages && seen.roster === roster && seen.rooms === this.roomsFloor && seen.guard === this.guardFloor) return seen.view;
    const view = { messages, state: yield* this.foldState(messages, roster) };
    look?.seen.set(this, { messages, roster, rooms: this.roomsFloor, guard: this.guardFloor, view });
    return view;
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
        this.ch.forgetInfo();
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
    if (unread.length) yield* this.markRead(unread.at(-1)!.seq);
    return { messages: unread, state };
  });

  /** Tell the channel this agent has read up to `seq`, waiting a moment for it to land; never fails. */
  markRead(seq: number): Effect.Effect<void, never, Relay> {
    return Effect.ignoreCause(Effect.timeout(this.ch.fx.markRead(seq), LAST_MARK_MS));
  }

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
   * the handler is done with one, which a pulled Stream can't promise. A handler that returns false
   * didn't get it to anyone (a webhook that failed): it isn't marked read.
   */
  listen<R = never>(onMessage: (m: Message, state: ChannelState) => Effect.Effect<void | boolean, unknown, R>, opts: Delivery & Hearing<R>): Effect.Effect<void, Refused | ChannelGone, Agent | R> {
    return Effect.gen({ self: this }, function* () {
      if (opts.hold !== false) yield* holding(this.alias, this.me);
      const status = (line: string) => opts.onStatus?.(line) ?? Effect.void;
      let { since, messages, state } = yield* this.reach(status);
      const cache = yield* Cache;
      const cursor = yield* Cursor;
      const seen = yield* cursor.seen(this.alias, this.me);
      /** In the background, for as long as this listens; its failure is nobody's business. */
      const aside = <E, R2>(e: Effect.Effect<unknown, E, R2>) => Effect.forkScoped(Effect.ignoreCause(e));

      /** How far this has handed messages for this agent on (read marks follow it), and how far it has said so. */
      let readTo = 0;
      let saidTo = 0;
      /** Says a read mark on the open socket (the relay's cheapest way in); null between connections. */
      let mark: ((seq: number) => boolean) | null = null;
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
          // Only what's for this agent, and only once it was handed on, moves the read mark: not its own words, nor chatter.
          if (!seen.has(m.seq) && this.wants(m, state, opts) && (yield* onMessage(m, state)) !== false) readTo = m.seq;
          yield* cursor.write(this.alias, this.me, m.seq);
        });

      // What's been handed on is read: said on the socket a second apart at most (nothing while it's down: the next
      // connection says it), and once more over HTTP when this ends, if the socket didn't get to.
      const sayRead = Effect.sync(() => {
        if (readTo > saidTo && mark?.(readTo)) saidTo = readTo;
      });
      if (opts.marks !== false) {
        yield* Effect.forkScoped(Effect.forever(Effect.andThen(Effect.sleep(MARK_EVERY_MS), sayRead)));
        yield* Effect.addFinalizer(() => Effect.suspend(() => (readTo > saidTo ? this.markRead(readTo) : Effect.void)));
      }

      const opened = ({ mark: on }: Extract<Live, { _tag: "Open" }>) =>
        Effect.gen({ self: this }, function* () {
          mark = on;
          // Members may have joined or left while we were disconnected.
          yield* aside(this.members(true));
        });

      const handle = (ev: Live): Effect.Effect<void, unknown, Agent | R | Scoped.Scope> => {
        switch (ev._tag) {
          case "Open":
            return opened(ev);
          case "Message":
            return hear(ev.message);
          case "Roster":
            this.postingChecked = false;
            return aside(Effect.andThen(this.members(true), this.chores()));
          case "Request":
            return opts.onNotice ? aside(this.notices(opts.onNotice)) : Effect.void;
          default:
            return Effect.void;
        }
      };
      if (opts.onNotice) yield* aside(this.notices(opts.onNotice));
      yield* eachLive(this.ch.fx.live(since, { presence: false, reads: false }), handle, status);
    }).pipe(Effect.scoped);
  }

  private ownerChannel() {
    return Effect.gen({ self: this }, function* (this: AgentSession) {
      if (this.identity.pk === this.cfg.ownerPk) return this.ch;
      const name = this.cfg.owner;
      if (!name) return null;
      const keys = yield* Keystore;
      if (!(yield* keys.identitiesIn(this.cfg.roomId)).includes(name)) return null;
      const identity = yield* keys.identity(name, this.cfg.roomId);
      return new Channel(this.cfg, this.cfg.relay, identity);
    });
  }

  notices<R>(notice: (text: string) => Effect.Effect<void, never, R>) {
    return Effect.gen({ self: this }, function* (this: AgentSession) {
      const owner = yield* this.ownerChannel();
      if (!owner) return;
      const budget = (yield* Keystore).budget;
      for (const r of yield* owner.fx.requests({ budget })) {
        if (r.check === "ready") {
          yield* notice(
            `join request: "${r.name}"${r.role ? ` (${r.role})` : ""} wants in, verification code ${r.code}. ` +
              `Only your human may approve, in the Kiwi app, after checking the code matches.`,
          );
        } else if (r.check === "unchecked") {
          yield* notice(`join request: "${r.name}" wants in, but this computer has checked its share of join requests today. ${TOO_MANY_REQUESTS}`);
        }
      }
    });
  }

  /**
   * Where listening starts: the cursor and the state. Starting up while the relay is briefly out of
   * reach (a deploy, a blip) waits and retries, like any drop later; past the quiet window it says so, once.
   */
  private reach(status: (line: string) => Effect.Effect<void>) {
    return Effect.gen({ self: this }, function* () {
      const start = Effect.gen({ self: this }, function* () {
        yield* this.chores();
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
        const { readAt, wake, ...rest } = p;
        found.set(p.from, { ...rest, ...(typeof p.role === "string" ? { role } : {}), ...(typeof readAt === "number" && Number.isFinite(readAt) ? { readAt } : {}), ...(isWakeVia(wake) ? { wake } : {}) });
      });
    const probing = eachLive(this.ch.fx.live(head, { presence: true, reads: false }), handle, () => Effect.void);
    const [mine] = yield* Effect.all([Effect.promise(() => daemonSeat(this.alias, this.me)), Effect.raceFirst(probing, Effect.raceFirst(Deferred.await(quiet), Effect.sleep(waitMs))).pipe(Effect.ignoreCause, Effect.scoped)], { concurrency: "unbounded" });
    const myWake = mine?.wake.on ? viaOf(mine.wake.path) : null;
    if (mine) found.set(this.me, { v: PROTOCOL_VERSION, type: "presence", from: this.me, client: "daemon", ts: Date.now(), ...(mine.read ? { readAt: mine.read.at } : {}), ...(myWake ? { wake: myWake } : {}) });
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
    const { state } = yield* this.state();
    const parent = !opts.room && opts.re?.length ? state.roomOf.get(opts.re[0]!) : undefined;
    const room = opts.ev ? undefined : (parent ?? (yield* this.roomId(opts.room)));
    // A task's thread has to be a task there is; a direct thread is with exactly one other member.
    if (opts.task !== undefined && !state.tasks.has(opts.task)) return yield* new Rejected(`no task ${taskId(opts.task)}`);
    if (opts.dm && (to?.length !== 1 || to[0] === this.me || !state.members.get(to[0]!)?.active)) return yield* new Rejected("a direct message goes to exactly one other member: --dm NAME");
    // A reply sits where its parent does: no task or dm on top of it.
    const inThread = !!opts.re?.length;
    const seq = yield* this.ch.fx.send(body, { ...opts, to, room, ...(inThread ? { task: undefined, dm: undefined } : {}) });
    if (opts.kind !== "event" && opts.re?.length) yield* this.ack(opts.re);
    return seq;
  }, oneLook);

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
      if (people.length) return yield* new Rejected(`this channel is coordinator-only: only ${state.coordinator} messages people. Send it to ${state.coordinator}, who passes it on, or for a decision only a person can make: kiwi send --escalate --re N "why".`);
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
    opts: { to?: string[]; kind?: Kind; waitSec?: number; imgs?: ImageAttachment[]; room?: string; task?: number; dm?: boolean },
  ) {
    const head = yield* this.ch.fx.head();
    const seq = yield* this.send(body, { to: opts.to, kind: opts.kind ?? "ask", imgs: opts.imgs, room: opts.room, ...(opts.task !== undefined ? { task: opts.task } : {}), ...(opts.dm ? { dm: true } : {}) });
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
    const listening = eachLive(this.ch.fx.live(since, { presence: false, reads: false }), handle, () => Effect.void);
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
    const sent = yield* this.ch.fx.send(body, { to, kind, re: [seq], imgs, room: state.roomOf.get(seq) ?? orig.room });
    yield* this.ack([seq]);
    return sent;
  }, oneLook);

  /** React to message #seq with an emoji, or take your reaction back (null). */
  readonly react = Effect.fn("AgentSession.react")({ self: this }, function* (this: AgentSession, seq: number, emoji: string | null) {
    if (emoji !== null && !wellFormedReaction(emoji)) return yield* new Rejected("a reaction is one emoji (no letters or digits)");
    const { state } = yield* this.state();
    if (!state.placeOf.has(seq) || ignored(state.trust.get(seq))) return yield* new Rejected(`no message #${seq} to react to`);
    return yield* this.confirm(yield* this.event({ op: "react", seq, emoji }, "reaction"));
  }, oneLook);

  /**
   * Coordinator-only: an agent answering (a reply, or taking on a task made from a message) tells the people
   * whose words it answers that they got through, with 👀 on each of their messages. The coordinator and
   * people don't: their answers reach people already. Once per message; never fails what it follows.
   */
  private ack(re: readonly number[]) {
    return Effect.ignoreCause(
      Effect.gen({ self: this }, function* () {
        const { messages, state } = yield* this.state();
        const me = state.members.get(this.me);
        if (!state.mode.coordinatorOnly || !state.coordinator || this.me === state.coordinator || !me || isPerson(me) || state.hold) return;
        for (const seq of answersPeople(state, messages, re)) {
          if (state.reactions.get(seq)?.has(this.me)) continue;
          yield* this.event({ op: "react", seq, emoji: ACK }, "reaction");
        }
      }),
    );
  }

  /** Announce yourself. After joining, a different role or rules is a request: the owner decides. */
  readonly hello = Effect.fn("AgentSession.hello")({ self: this }, function* (this: AgentSession, role?: string, about?: string) {
    return yield* this.event({ op: "hello", role, about }, `joined${role ? ` as ${role}` : ""}`);
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
  }, oneLook);

  /**
   * This person's own colour (null clears it), signed by them. The fold refuses a colour someone
   * else has, and colours on agents. The owner sets anyone's in the app (OwnerSession here).
   */
  readonly setColor = Effect.fn("AgentSession.setColor")({ self: this }, function* (this: AgentSession, member: string, color: Color | null) {
    if (member !== this.me) return yield* new Rejected("you set your own colour; the owner sets anyone else's in the Kiwi app");
    const ev: Event = { op: "color.set", member, color };
    yield* this.mayI({ kind: "event", ev });
    return yield* this.confirm(yield* this.ch.fx.send(color ? `${member}'s colour is ${color}` : `cleared ${member}'s colour`, { kind: "event", ev }));
  }, oneLook);

  // ---------- events ----------

  private event(ev: Event, body: string, to?: string[], re?: number) {
    return Effect.gen({ self: this }, function* () {
      yield* this.mayI({ kind: "event", ev });
      return yield* this.ch.fx.send(body, { kind: "event", ev, to: to?.length ? [...new Set(to)].filter((n) => n !== this.me) : undefined, ...(re !== undefined ? { re: [re] } : {}) });
    });
  }

  /** Send an event, then confirm the fold accepted it (it may lose a race). */
  protected confirm(seq: number) {
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
    opts: { detail?: string; owner?: string; review?: string; re?: number } = {},
  ) {
    const { state } = yield* this.state();
    if (opts.re !== undefined && (!state.placeOf.has(opts.re) || ignored(state.trust.get(opts.re)))) return yield* new Rejected(`no message #${opts.re}`);
    const owner = opts.owner && (yield* this.resolveTo([opts.owner], state))?.[0];
    const review = opts.review === undefined ? undefined : yield* this.reviewer(state, opts.review);
    return yield* this.event(
      {
        op: "task.add",
        title,
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(owner ? { owner } : {}),
        ...(review ? { review } : {}),
      },
      `task: ${title}`,
      [...(owner ? [owner] : []), ...(review && review !== "*" ? [review] : [])],
      opts.re,
    );
  }, oneLook);

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
    if (t.owner && t.owner !== this.me) return yield* new Rejected(`${taskId(id)} is owned by ${t.owner}`);
    const seq = yield* this.event({ op: "task.claim", task: id }, `claimed ${taskId(id)}`);
    const after = yield* this.confirm(seq);
    if (t.source !== undefined) yield* this.ack([t.source]);
    return after;
  }, oneLook);

  readonly taskUpdate = Effect.fn("AgentSession.taskUpdate")({ self: this }, function* (
    this: AgentSession,
    id: number,
    change: { state?: TaskState | "cancelled"; owner?: string | null; title?: string; note?: string; review?: string | null; verdict?: Verdict; at?: string; round?: number },
    reviewText?: string,
  ) {
    const { state } = yield* this.state();
    const t = state.tasks.get(id);
    if (!t) return yield* new Rejected(`no task ${taskId(id)}`);
    if (change.state && change.state !== "cancelled" && !TASK_STATES.includes(change.state)) return yield* new Rejected(`state must be one of ${TASK_STATES.join(", ")}`);
    const owner = change.owner ? (yield* this.resolveTo([change.owner], state))?.[0] : change.owner;
    const review = change.review ? yield* this.reviewer(state, change.review) : change.review;
    // Said here rather than left to every client's fold: the doer can't mark its own reviewed work done.
    const me = state.members.get(this.me);
    const gate = review === undefined ? t.review : review || undefined;
    const finishing = change.state === "done" || change.state === "cancelled";
    const notReviewer = !!gate && !!me && !isPerson(me) && (gate === "*" ? (owner ?? t.owner) === this.me || t.workedBy.includes(this.me) : gate !== this.me);
    const open = openRound(t);
    const revised = change.state === "cancelled" ? revisedOut(t, this.me, open) : null;
    if (finishing && t.state !== "done" && notReviewer && revised === null) {
      const what = change.state === "cancelled" ? "cancelled" : "done";
      return yield* new Rejected(`${taskId(id)} needs review by ${gate === "*" ? "someone who hasn't worked on it" : gate} before it's ${what}: ${change.state === "cancelled" ? "ask a person or its reviewer to cancel it, or cancel it yourself once a review round has rejected it" : `send it for review (kiwi task review ${taskId(id)})`}`);
    }
    if (change.verdict && notReviewer) return yield* new Rejected(`only ${gate === "*" ? "someone who hasn't worked on it" : gate} gives ${taskId(id)}'s verdict`);
    const judged = change.verdict && t.rounds.length ? yield* judgedRound(t, open, change.round, change.at) : null;
    const round = judged ? { round: judged.n, ...(judged.at ? { at: judged.at } : {}) } : revised !== null && notReviewer ? { round: revised } : {};
    const body = change.verdict && reviewText?.trim() ? { body: "review" as const } : {};
    const { round: _round, at: _at, ...rest } = change;
    const opening = change.state === "review" && change.at?.trim() ? { at: change.at.trim() } : {};
    // Tell whoever this concerns: the new owner, the current owner if it isn't
    // us, and the creator when it's done.
    const notify: string[] = [];
    if (owner) notify.push(owner);
    if (t.owner && t.owner !== this.me) notify.push(t.owner);
    // In review: whoever must approve it hears; a named reviewer, or the one just named.
    const reviewerName = (review ?? t.review) !== "*" ? (review ?? t.review) : undefined;
    if ((change.state === "review" || review) && reviewerName) notify.push(reviewerName);
    if (finishing) notify.push(t.createdBy);
    const seq = yield* this.event(
      { op: "task.update", task: id, ...rest, ...opening, ...(owner !== undefined ? { owner } : {}), ...(review !== undefined ? { review } : {}), ...round, ...body },
      body.body ? (reviewText ?? "") : `${taskId(id)} ${change.verdict ?? change.state ?? "updated"}`,
      notify,
    );
    const after = yield* this.confirm(seq);
    // Starting a task made from someone's message answers it.
    if (change.state === "doing" && t.source !== undefined) yield* this.ack([t.source]);
    return after;
  }, oneLook);

  /** Give a task to someone else, with a note on where it stands and what's next. */
  readonly taskHandoff = Effect.fn("AgentSession.taskHandoff")({ self: this }, function* (this: AgentSession, id: number, to: string, next: string | undefined) {
    const { state } = yield* this.state();
    const target = (yield* this.resolveTo([to], state))?.[0];
    if (!target || !state.members.get(target)?.active) return yield* new Rejected(`no member named ${to}`);
    if (target === this.me) return yield* new Rejected("hand it to someone else");
    return yield* this.taskUpdate(id, { owner: target, ...(next ? { note: next } : {}), ...(state.tasks.get(id)?.state === "doing" ? { state: "todo" as const } : {}) });
  }, oneLook);

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
  }, oneLook);

  readonly setFact = Effect.fn("AgentSession.setFact")({ self: this }, function* (this: AgentSession, key: string, value: string, ttlSec?: number) {
    return yield* this.event({ op: "fact.set", key, value, ...(ttlSec ? { ttl: ttlSec } : {}) }, `${key} = ${value}`);
  });

  readonly delFact = Effect.fn("AgentSession.delFact")({ self: this }, function* (this: AgentSession, key: string) {
    return yield* this.event({ op: "fact.del", key }, `unset ${key}`);
  });
}

/** One agent's session on one channel, with its key loaded. Agents never hold an owner key (the app does). */
export const openSession = Effect.fn("AgentSession.open")(function* (alias: string, cfg: ChannelConfig, name: string) {
  const keys = yield* Keystore;
  // Member records: the newest this machine has seen per key wins, across runs.
  keepRecordsIn(keys.records);
  keepAnswersIn(keys.answers ?? null);
  // Join creates the key first (loadIdentity). Everything else must use a name this machine already holds.
  if (!(yield* keys.identitiesIn(cfg.roomId)).includes(name)) {
    return yield* Effect.fail(new Error(`${name} has no key in "${alias}" on this machine`));
  }
  const identity = yield* keys.identity(name, cfg.roomId);
  return new AgentSession(alias, cfg, identity, (a) => Effect.runSync(keys.saveAccess(alias, a)));
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
  // A task's thread is for the agents working it (and its reviewer and the coordinator); a direct thread
  // for its two. Anyone named in a message still gets it. Main follows the rules below.
  const place = state?.placeOf.get(m.seq);
  // (A conversation started there counts too: whoever is in it hears its replies.)
  if (state && place && place.kind !== "main") return isDirectedAt(m, me) || threadMembers(state, place).includes(me) || !!state.threadPeople.get(state.threadOf.get(m.seq) ?? m.seq)?.has(me);
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

/** What an agent's automatic reaction is: "seen, on it". */
export const ACK = "👀";

/**
 * The people's messages that answering `re` answers: each one it names that a person wrote, or, through
 * someone else's message that passed it on (the coordinator forwarding it, a task made from it), the
 * person's message that one answers. A few steps at most; only verified messages count.
 */
export function answersPeople(state: Pick<ChannelState, "members" | "trust">, messages: readonly Message[], re: readonly number[]): number[] {
  const bySeq = new Map(messages.map((m) => [m.seq, m]));
  const out = new Set<number>();
  const walk = (seq: number, depth: number) => {
    const m = bySeq.get(seq);
    if (!m || state.trust.get(seq) !== "verified") return;
    const from = state.members.get(m.from);
    if (from && isPerson(from)) {
      if (m.kind !== "event") out.add(seq);
      return;
    }
    if (depth < 3) for (const r of m.re ?? []) walk(r, depth + 1);
  };
  for (const r of re) walk(r, 0);
  return [...out];
}
