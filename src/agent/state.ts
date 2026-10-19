import * as Effect from "effect/Effect";
import { Channel, type Info, type MemberRow, type Refused, type Relay } from "@kiwi/core/client.ts";
import { Cache, Cursor, type ChannelConfig } from "../config.ts";
import type { ChannelAccess } from "@kiwi/core/crypto.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import type { DaemonPeek } from "../daemon/protocol.ts";
import { daemonMark, daemonPeek } from "../daemon/rpc.ts";
import { GENERAL_ROOM, PAGE_LIMIT, type Message } from "@kiwi/core/protocol.ts";
import { Rejected } from "@kiwi/core/refusals.ts";
import { findRoom, fold, toRoster, type ChannelState, type FoldBase, type GuardFloor, type Roster, type RoomsFloor } from "@kiwi/core/state.ts";
import { LAST_MARK_MS, lastSeq, Look, orNone, type Agent, type Delivery } from "./shared.ts";
import { wants } from "./wants.ts";

export class SessionState {
  readonly ch: Channel;
  private roster: Roster | null = null;
  protected postingChecked = false;
  protected roomsFloor: RoomsFloor | null | undefined;
  protected guardFloor: GuardFloor | null | undefined;
  private roomsCheckedAt = 0;
  private log: Message[] | null = null;
  private saved = 0;
  private owed = 0;
  private daemonLive = false;
  protected base: FoldBase | null = null;
  protected partial = false;

  constructor(
    readonly alias: string,
    readonly cfg: ChannelConfig,
    readonly identity: Identity,
    persist: (a: ChannelAccess) => void,
  ) {
    this.ch = new Channel(cfg, cfg.relay, identity, persist, { keepInfo: true });
    this.ch.onSent = (seq, m) => {
      if (m && this.log && seq === lastSeq(this.log) + 1) this.log = [...this.log, m];
      else this.owed = Math.max(this.owed, seq);
    };
  }

  get me(): string {
    return this.identity.name;
  }

  readonly members = Effect.fn("AgentSession.members")({ self: this }, function* (this: SessionState, refresh = false, rows?: readonly MemberRow[]) {
    if (!this.roster || refresh) this.roster = (yield* this.ch.fx.members(refresh ? undefined : rows)).map(toRoster);
    return this.roster;
  });

  protected chores(): Effect.Effect<void, Refused, Agent> {
    return Effect.void;
  }

  readonly sync = Effect.fn("AgentSession.sync")({ self: this }, function* (this: SessionState, peeked?: DaemonPeek | null) {
    const cache = yield* Cache;
    if (!this.log) {
      const cached = yield* cache.read(this.cfg.roomId);
      this.saved = Math.max(this.saved, lastSeq(cached));
      this.log ??= cached;
      this.base ??= yield* cache.base(this.cfg.roomId);
    }
    const look = yield* Look;
    const seen = peeked === undefined ? yield* this.peek() : peeked;
    const current = seen !== null && seen.head <= lastSeq(this.log) && lastSeq(this.log) >= this.owed;
    if (!current && (!look?.fetched.has(this) || lastSeq(this.log) < this.owed)) {
      const fetched = !this.log.length && !this.base ? yield* this.ch.fx.snapshot() : null;
      const from = Math.max(lastSeq(this.log), this.base?.n ?? fetched?.n ?? 0);
      const { messages, first } = yield* this.ch.fx.history(from);
      const gap = first !== null && first > from + 1;
      if (gap) {
        this.partial = true;
        this.base = null;
        yield* cache.dropBase(this.cfg.roomId);
      } else if (fetched) {
        yield* cache.keepBase(this.cfg.roomId, fetched);
        this.base ??= fetched;
      }
      const fresh = messages.filter((m) => m.seq > lastSeq(this.log!));
      if (fresh.length) this.log = [...this.log!, ...fresh];
      look?.fetched.add(this);
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
    const [messages, roster] = yield* Effect.all([this.sync(seen), this.members(false, seen?.members ?? undefined)], { concurrency: "unbounded" });
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

  protected foldState(messages: Message[], roster: Roster, info?: Info): Effect.Effect<ChannelState, never, Relay> {
    return Effect.gen({ self: this }, function* () {
      this.roomsFloor ??= yield* orNone(this.ch.fx.rooms(info));
      this.guardFloor ??= yield* orNone(this.ch.fx.guard(info));
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
      if (kept.base && this.publish) yield* this.publish(kept.base);
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
      const older = (yield* this.ch.fx.page(since, step)).filter((m) => m.seq <= since + step);
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
    yield* cursor.write(this.alias, this.me, head);
    return head;
  });

  wants(m: Message, state: ChannelState | null, d: Delivery = {}): boolean {
    return wants(this.me, m, state, d);
  }

  readonly unread = Effect.fn("AgentSession.unread")({ self: this }, function* (this: SessionState, d: Delivery = {}) {
    const since = yield* this.cursor();
    const { messages, state } = yield* this.state();
    const cursor = yield* Cursor;
    const seen = yield* cursor.seen(this.alias, this.me);
    const unread = messages.filter((m) => m.seq > since && !seen.has(m.seq) && this.wants(m, state, d));
    const commit = (shownTo?: number): Effect.Effect<void, never, Relay> => {
      const last = (shownTo === undefined ? unread : unread.filter((m) => m.seq <= shownTo)).at(-1)?.seq;
      const upTo = shownTo === undefined ? Math.max(since, state.head) : Math.max(since, shownTo);
      return Effect.andThen(cursor.write(this.alias, this.me, upTo), last === undefined ? Effect.void : this.markRead(last));
    };
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

  readonly unreadCount = Effect.fn("AgentSession.unreadCount")({ self: this }, function* (this: SessionState, state: ChannelState, messages: Message[]) {
    const cursor = yield* Cursor;
    const since = (yield* cursor.read(this.alias, this.me)) ?? state.head;
    const seen = yield* cursor.seen(this.alias, this.me);
    return messages.filter((m) => m.seq > since && !seen.has(m.seq) && this.wants(m, state)).length;
  });
}
