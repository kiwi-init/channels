import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { Channel, downWhy, OfflineReads, relayDown, type Info, type MemberRow, type Refused, type Relay } from "@kiwi/core/client.ts";
import { Cache, Cursor, loadConfig, type ChannelConfig } from "../config.ts";
import type { ChannelAccess } from "@kiwi/core/crypto.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import type { DaemonPeek } from "../daemon/protocol.ts";
import { seatHolds, seatRefusal } from "../hold.ts";
import { daemonMark, daemonPeek } from "../daemon/rpc.ts";
import { decodedWhole, GENERAL_ROOM, knownOp, olderRules, outgrown, PAGE_LIMIT, type Message } from "@kiwi/core/protocol.ts";
import { Rejected } from "@kiwi/core/refusals.ts";
import { findRoom, fold, rosterOf, type ChannelState, type FoldBase, type GuardFloor, type Roster, type RoomsFloor } from "@kiwi/core/state.ts";
import { LAST_MARK_MS, lastSeq, Look, orNone, type Agent, type Delivery } from "./shared.ts";
import { narrows, wants } from "./wants.ts";

type WholeLog = Effect.Success<ReturnType<Channel["fx"]["history"]>>;

const CACHE_TRIM_AT = 800;
const CACHE_KEEP = 300;

const NOT_A_MEMBER = " isn't a member";

function poisoned(base: FoldBase, roster: Roster): boolean {
  const names = new Set(roster.filter((r) => r.kind !== "computer").map((r) => r.name));
  return base.rejected.some(([, why]) => why.endsWith(NOT_A_MEMBER) && names.has(why.slice(0, -NOT_A_MEMBER.length)));
}

export const outgrownCache = (cached: readonly Message[], base: FoldBase | null): boolean => cached.some((m) => m.newer !== undefined && knownOp(m.newer.op)) || (!!base && outgrown(base));

function strangers(rejected: Iterable<readonly [number, string]>, after: number): boolean {
  for (const [seq, why] of rejected) if (seq > after && (why.endsWith(NOT_A_MEMBER) || why.startsWith("not signed by "))) return true;
  return false;
}

export class SessionState {
  readonly ch: Channel;
  private roster: Roster | null = null;
  protected postingChecked = false;
  protected roomsFloor: RoomsFloor | null | undefined;
  protected guardFloor: GuardFloor | null | undefined;
  private roomsCheckedAt = 0;
  private rosterCheckedAt = 0;
  private healed = false;
  private log: Message[] | null = null;
  private saved = 0;
  private owed = 0;
  private daemonLive = false;
  protected base: FoldBase | null = null;
  protected partial = false;
  private replayed: { page: WholeLog | null } | null = null;
  readonly opened: number;

  constructor(
    readonly alias: string,
    readonly cfg: ChannelConfig,
    readonly identity: Identity,
    persist: (a: ChannelAccess) => void,
  ) {
    this.ch = new Channel(cfg, cfg.relay, identity, persist, { keepInfo: true });
    this.opened = seatHolds(loadConfig(), alias, identity.name);
    this.ch.onSent = (seq, m) => {
      if (m && this.log && seq === lastSeq(this.log) + 1) this.log = [...this.log, m];
      else this.owed = Math.max(this.owed, seq);
    };
  }

  get me(): string {
    return this.identity.name;
  }

  readonly unheld = Effect.suspend(() => {
    const why = seatRefusal(loadConfig(), this.alias, this.me, this.opened);
    return why ? Effect.fail(new Rejected(why)) : Effect.void;
  });

  whileOurs<R>(effect: Effect.Effect<void, never, R>): Effect.Effect<void, never, R> {
    return Effect.flatMap(Effect.exit(this.unheld), (still) => (Exit.isSuccess(still) ? effect : Effect.void));
  }

  owe(seq: number): void {
    this.owed = Math.max(this.owed, seq);
  }

  readonly members = Effect.fn("AgentSession.members")({ self: this }, function* (this: SessionState, refresh = false, rows?: readonly MemberRow[]) {
    if (!this.roster || refresh) this.roster = rosterOf(yield* this.ch.fx.members(refresh ? undefined : rows));
    return this.roster;
  });

  protected chores(): Effect.Effect<void, Refused, Agent> {
    return Effect.void;
  }

  private wholeLog(): Effect.Effect<WholeLog | null, never, Agent> {
    const tried = this.replayed;
    if (tried) return Effect.succeed(tried.page);
    return Effect.gen({ self: this }, function* () {
      const one = yield* Effect.orElseSucceed(this.ch.fx.page(0, 1), () => []);
      const all = one[0]?.seq === 1 ? yield* Effect.orElseSucceed(this.ch.fx.history(0), () => null) : null;
      const page = all && decodedWhole(all) ? all : null;
      this.replayed = { page };
      return page;
    });
  }

  readonly sync = Effect.fn("AgentSession.sync")({ self: this }, function* (this: SessionState, peeked?: DaemonPeek | null) {
    const cache = yield* Cache;
    if (!this.log) {
      const cached = yield* cache.read(this.cfg.roomId);
      const base = yield* cache.base(this.cfg.roomId);
      if (outgrownCache(cached, base)) {
        yield* cache.replace(this.cfg.roomId, []);
        yield* cache.dropBase(this.cfg.roomId);
        this.log ??= [];
      } else {
        this.saved = Math.max(this.saved, lastSeq(cached));
        this.log ??= cached;
        this.base ??= base && (yield* this.ch.fx.openRooms(base));
        for (const m of cached) if (m.ev?.op === "room.seal") yield* this.ch.fx.settle(m);
      }
    }
    const replaced = this.base && olderRules(this.base) ? yield* this.wholeLog() : null;
    if (replaced) {
      this.base = null;
      this.log = replaced.messages;
      this.saved = lastSeq(replaced.messages);
      yield* cache.replace(this.cfg.roomId, replaced.messages);
      yield* cache.dropBase(this.cfg.roomId);
    }
    const look = yield* Look;
    const seen = peeked === undefined ? yield* this.peek() : peeked;
    const first = this.log[0]?.seq;
    const holed = first !== undefined && first > (this.base?.n ?? 0) + 1;
    const current = !holed && seen !== null && seen.head <= lastSeq(this.log) && lastSeq(this.log) >= this.owed;
    if (!current && (holed || !look?.fetched.has(this) || lastSeq(this.log) < this.owed)) {
      const offered = !this.base && (first === undefined || first > 1) ? yield* this.ch.fx.snapshot() : null;
      const whole = offered && olderRules(offered) ? yield* this.wholeLog() : null;
      const fetched = whole ? null : offered;
      const floor = this.base?.n ?? fetched?.n ?? 0;
      const hole = first !== undefined && first > floor + 1;
      const from = hole ? floor : Math.max(lastSeq(this.log), floor);
      const offline = yield* OfflineReads;
      const cachedOnly = !!offline && !fetched && this.log.length > 0;
      const page = yield* (whole && from === 0 ? Effect.succeed(whole) : this.ch.fx.history(from)).pipe(
        Effect.catchIf(
          (err) => cachedOnly && relayDown(err),
          (err) => Effect.sync(() => (offline?.note(downWhy(err)), null)),
        ),
      );
      if (page) {
        const gap = page.first !== null && page.first > from + 1;
        if (gap) {
          this.partial = true;
          this.base = null;
          yield* cache.dropBase(this.cfg.roomId);
        } else if (fetched) {
          yield* cache.keepBase(this.cfg.roomId, fetched);
          this.base ??= fetched;
        }
        if (hole) {
          const bySeq = new Map(this.log!.map((m) => [m.seq, m]));
          for (const m of page.messages) bySeq.set(m.seq, m);
          this.log = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
          yield* cache.replace(this.cfg.roomId, this.log);
          this.saved = lastSeq(this.log);
        } else {
          const fresh = page.messages.filter((m) => m.seq > lastSeq(this.log!));
          if (fresh.length) this.log = [...this.log!, ...fresh];
        }
        look?.fetched.add(this);
      }
    }
    const log = this.log!;
    const unsaved = log.filter((m) => m.seq > this.saved);
    if (unsaved.length) {
      yield* cache.append(this.cfg.roomId, unsaved);
      this.saved = Math.max(this.saved, lastSeq(unsaved));
    }
    return log;
  });

  readonly state = Effect.fn("AgentSession.state")({ self: this }, function* (this: SessionState) {
    yield* this.chores();
    const seen = yield* this.peek();
    const [synced, roster] = yield* Effect.all([this.sync(seen), this.members(false, seen?.members ?? undefined)], { concurrency: "unbounded" });
    let messages = synced;
    if (this.base && !this.healed && poisoned(this.base, roster)) {
      this.healed = true;
      yield* (yield* Cache).dropBase(this.cfg.roomId);
      this.base = null;
      messages = yield* this.sync(seen);
    }
    const look = yield* Look;
    const prior = look?.seen.get(this);
    if (prior && prior.messages === messages && prior.roster === roster && prior.rooms === this.roomsFloor && prior.guard === this.guardFloor) return prior.view;
    const view = { messages, state: yield* this.foldState(messages, roster, seen?.info ?? undefined) };
    look?.seen.set(this, { messages, roster, rooms: this.roomsFloor, guard: this.guardFloor, view });
    return view;
  });

  private peek(): Effect.Effect<DaemonPeek | null> {
    return Effect.promise(async () => {
      const seen = await daemonPeek(this.alias, this.me, this.cfg.roomId);
      this.daemonLive = seen !== null;
      return seen;
    });
  }

  protected foldState(messages: Message[], given: Roster, info?: Info): Effect.Effect<ChannelState, never, Relay | Cache> {
    return Effect.gen({ self: this }, function* () {
      this.roomsFloor ??= yield* orNone(this.ch.fx.rooms(info));
      this.guardFloor ??= yield* orNone(this.ch.fx.guard(info));
      let roster = given;
      let fresh = false;
      const since = this.base?.n ?? 0;
      const refresh = Effect.gen({ self: this }, function* () {
        const now = yield* orNone(this.members(true));
        if (now) [roster, fresh] = [now, true];
        return !!now;
      });
      const kept: { base?: FoldBase } = {};
      const keep = this.snapshotDue?.(messages.at(-1)?.seq ?? 0) ? (b: FoldBase) => void (kept.base = b) : undefined;
      let state = fold(messages, roster, Date.now(), this.roomsFloor, this.guardFloor, this.base, keep);
      const unknown = [...state.rejected].some(([seq, why]) => seq > this.roomsCheckedAt && why.startsWith("no room "));
      if (unknown) {
        this.roomsCheckedAt = state.head;
        this.ch.forgetInfo();
        this.roomsFloor = yield* orNone(this.ch.fx.rooms());
        state = fold(messages, roster, Date.now(), this.roomsFloor, this.guardFloor, this.base, keep);
      }
      if (strangers(state.rejected, Math.max(since, this.rosterCheckedAt))) {
        this.rosterCheckedAt = state.head;
        if (yield* refresh) {
          kept.base = undefined;
          state = fold(messages, roster, Date.now(), this.roomsFloor, this.guardFloor, this.base, keep);
        }
      }
      if (kept.base && this.publish && (!strangers(kept.base.rejected, since) || fresh)) yield* this.publish(kept.base);
      if (messages.length > CACHE_TRIM_AT && !this.partial) {
        const trimmed = (): FoldBase | undefined => {
          const older: { base?: FoldBase } = {};
          fold(messages.slice(0, messages.length - CACHE_KEEP), roster, Date.now(), this.roomsFloor, this.guardFloor, this.base, (b) => void (older.base = b));
          return older.base;
        };
        let older = trimmed();
        if (older && strangers(older.rejected, since) && !fresh) older = (yield* refresh) ? trimmed() : undefined;
        if (older) yield* (yield* Cache).trim(this.cfg.roomId, older);
      }
      return state;
    });
  }

  protected snapshotDue?(head: number): boolean;

  protected publish?(base: FoldBase): Effect.Effect<void, never, Relay>;

  readonly message = Effect.fn("AgentSession.message")({ self: this }, function* (this: SessionState, seq: number, messages: readonly Message[]) {
    const held = messages.find((m) => m.seq === seq);
    if (held || !this.base || seq > this.base.n || seq < 1) return held ?? null;
    return (yield* this.ch.fx.page(seq - 1, 1)).find((m) => m.seq === seq) ?? null;
  });

  readonly threadMessages = Effect.fn("AgentSession.threadMessages")({ self: this }, function* (this: SessionState, root: number, messages: readonly Message[], state: ChannelState) {
    const held = new Set(messages.map((m) => m.seq));
    const missing = [...state.threadOf]
      .filter(([seq, r]) => r === root && !held.has(seq))
      .map(([seq]) => seq)
      .sort((a, b) => a - b);
    const wanted = new Set(missing);
    const older: Message[] = [];
    for (let i = 0; i < missing.length;) {
      const from = missing[i]!;
      let j = i;
      while (j + 1 < missing.length && missing[j + 1]! - from < PAGE_LIMIT && missing[j + 1]! - missing[j]! <= 50) j++;
      older.push(...(yield* this.ch.fx.page(from - 1, missing[j]! - from + 1)).filter((m) => wanted.has(m.seq)));
      i = j + 1;
    }
    return [...older, ...messages.filter((m) => state.threadOf.get(m.seq) === root)].sort((a, b) => a.seq - b.seq);
  });

  readonly earlier = Effect.fn("AgentSession.earlier")({ self: this }, function* (this: SessionState, messages: Message[], n: number, shown: (m: Message) => boolean = () => true) {
    if (!this.base) return messages;
    let out = messages;
    let first = Math.min(messages[0]?.seq ?? this.base.n + 1, this.base.n + 1);
    let step = 0;
    for (let seen = out.filter(shown).length; first > 1 && seen < n; seen = out.filter(shown).length) {
      step = Math.min(PAGE_LIMIT, first - 1, Math.max(step * 2, n - seen));
      const since = first - 1 - step;
      const offline = yield* OfflineReads;
      const page = yield* this.ch.fx.page(since, step).pipe(
        Effect.catchIf(
          (err) => !!offline && relayDown(err),
          (err) => Effect.sync(() => (offline?.note(downWhy(err)), null)),
        ),
      );
      if (!page) break;
      const older = page.filter((m) => m.seq <= since + step);
      if (!older.length) break;
      out = [...older, ...out];
      first = since + 1;
    }
    return out;
  });

  readonly roomId = Effect.fn("AgentSession.roomId")({ self: this }, function* (this: SessionState, nameOrId: string | undefined, state?: ChannelState) {
    if (!nameOrId) return GENERAL_ROOM;
    const s = state ?? (yield* this.state()).state;
    const room = findRoom(s, nameOrId);
    if (!room) return yield* new Rejected(`no room ${nameOrId}: kiwi rooms lists them`);
    return room.id;
  });

  readonly cursor = Effect.fn("AgentSession.cursor")({ self: this }, function* (this: SessionState) {
    const cursor = yield* Cursor;
    const c = yield* cursor.read(this.alias, this.me);
    if (c !== null) return c;
    const head = yield* this.ch.fx.head();
    yield* this.whileOurs(cursor.write(this.alias, this.me, head));
    return head;
  });

  wants(m: Message, state: ChannelState | null, d: Delivery = {}): boolean {
    return wants(this.me, m, state, d);
  }

  readonly unread = Effect.fn("AgentSession.unread")({ self: this }, function* (this: SessionState, d: Delivery = {}) {
    yield* this.unheld;
    const since = yield* this.cursor();
    const { messages, state } = yield* this.state();
    const cursor = yield* Cursor;
    const seen = yield* cursor.seen(this.alias, this.me);
    const unread = messages.filter((m) => m.seq > since && !seen.has(m.seq) && this.wants(m, state, d));
    const held = narrows(d) ? messages.find((m) => m.seq > since && !seen.has(m.seq) && this.wants(m, state) && !this.wants(m, state, d))?.seq : undefined;
    const commit = (shownTo?: number): Effect.Effect<void, never, Relay> => {
      const shown = shownTo === undefined ? unread : unread.filter((m) => m.seq <= shownTo);
      const last = shown.at(-1)?.seq;
      const reach = shownTo === undefined ? state.head : shownTo;
      const upTo = Math.max(since, held === undefined ? reach : Math.min(reach, held - 1));
      const ahead = shown.filter((m) => m.seq > upTo).map((m) => m.seq);
      const moves = Effect.andThen(
        Effect.andThen(cursor.write(this.alias, this.me, upTo), ahead.length ? cursor.markSeen(this.alias, this.me, ahead) : Effect.void),
        last === undefined ? Effect.void : this.markRead(last),
      );
      return this.whileOurs(moves);
    };
    yield* this.unheld;
    return { messages: unread, state, commit };
  });

  readonly read = Effect.fn("AgentSession.read")({ self: this }, function* (this: SessionState, d: Delivery = {}) {
    const { messages, state, commit } = yield* this.unread(d);
    yield* commit();
    return { messages, state };
  });

  markRead(seq: number): Effect.Effect<void, never, Relay> {
    const overHttp = Effect.ignoreCause(Effect.timeout(this.ch.fx.markRead(seq), LAST_MARK_MS));
    if (!this.daemonLive) return overHttp;
    return Effect.flatMap(
      Effect.promise(() => daemonMark(this.alias, this.me, seq)),
      (marked) => (marked ? Effect.void : overHttp),
    );
  }

  readonly unreadAt = Effect.fn("AgentSession.unreadAt")({ self: this }, function* (this: SessionState, state: ChannelState, messages: Message[], d: Delivery = {}) {
    const cursor = yield* Cursor;
    const since = (yield* cursor.read(this.alias, this.me)) ?? state.head;
    const seen = yield* cursor.seen(this.alias, this.me);
    const seqs = messages.filter((m) => m.seq > since && !seen.has(m.seq) && this.wants(m, state, d)).map((m) => m.seq);
    return { unread: seqs.length, cursor: since, seqs };
  });

  readonly unreadCount = Effect.fn("AgentSession.unreadCount")({ self: this }, function* (this: SessionState, state: ChannelState, messages: Message[]) {
    return (yield* this.unreadAt(state, messages)).unread;
  });
}
