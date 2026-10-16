import * as Effect from "effect/Effect";
import { Channel, type Refused, type Relay } from "../client.ts";
import { Cache, Cursor, type ChannelConfig } from "../config.ts";
import type { ChannelAccess } from "../crypto.ts";
import type { Identity } from "../identity.ts";
import { GENERAL_ROOM, type Message } from "../protocol.ts";
import { Rejected } from "../refusals.ts";
import { findRoom, fold, type ChannelState, type GuardFloor, type Roster, type RoomsFloor } from "../state.ts";
import { LAST_MARK_MS, lastSeq, Look, orNone, toRoster, type Agent, type Delivery } from "./shared.ts";
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

  readonly members = Effect.fn("AgentSession.members")({ self: this }, function* (this: SessionState, refresh = false) {
    if (!this.roster || refresh) this.roster = (yield* this.ch.fx.members()).map(toRoster);
    return this.roster;
  });

  protected chores(): Effect.Effect<void, Refused, Agent> {
    return Effect.void;
  }

  readonly sync = Effect.fn("AgentSession.sync")({ self: this }, function* (this: SessionState) {
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

  readonly state = Effect.fn("AgentSession.state")({ self: this }, function* (this: SessionState) {
    yield* this.chores();
    const [messages, roster] = yield* Effect.all([this.sync(), this.members()], { concurrency: "unbounded" });
    const look = yield* Look;
    const seen = look?.seen.get(this);
    if (seen && seen.messages === messages && seen.roster === roster && seen.rooms === this.roomsFloor && seen.guard === this.guardFloor) return seen.view;
    const view = { messages, state: yield* this.foldState(messages, roster) };
    look?.seen.set(this, { messages, roster, rooms: this.roomsFloor, guard: this.guardFloor, view });
    return view;
  });

  protected foldState(messages: Message[], roster: Roster): Effect.Effect<ChannelState, never, Relay> {
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

  readonly read = Effect.fn("AgentSession.read")({ self: this }, function* (this: SessionState, d: Delivery = {}) {
    const since = yield* this.cursor();
    const { messages, state } = yield* this.state();
    const cursor = yield* Cursor;
    const seen = yield* cursor.seen(this.alias, this.me);
    const unread = messages.filter((m) => m.seq > since && !seen.has(m.seq) && this.wants(m, state, d));
    yield* cursor.write(this.alias, this.me, Math.max(since, state.head));
    if (unread.length) yield* this.markRead(unread.at(-1)!.seq);
    return { messages: unread, state };
  });

  markRead(seq: number): Effect.Effect<void, never, Relay> {
    return Effect.ignoreCause(Effect.timeout(this.ch.fx.markRead(seq), LAST_MARK_MS));
  }

  readonly unreadCount = Effect.fn("AgentSession.unreadCount")({ self: this }, function* (this: SessionState, state: ChannelState, messages: Message[]) {
    const cursor = yield* Cursor;
    const since = (yield* cursor.read(this.alias, this.me)) ?? state.head;
    const seen = yield* cursor.seen(this.alias, this.me);
    return messages.filter((m) => m.seq > since && !seen.has(m.seq) && this.wants(m, state)).length;
  });
}
