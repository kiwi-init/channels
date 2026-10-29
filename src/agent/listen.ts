import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import type * as Scoped from "effect/Scope";
import { Channel, eachLive, QUIET_DROP_MS, reason, type ChannelGone, type Live, type Refused } from "@kiwi/core/client.ts";
import { Cache, Cursor, Keystore } from "../config.ts";
import { daemonPresence, daemonSeat } from "../daemon/rpc.ts";
import { isReach, PROTOCOL_VERSION, type Message, type Presence } from "@kiwi/core/protocol.ts";
import { Rejected } from "@kiwi/core/refusals.ts";
import { TOO_MANY_REQUESTS } from "@kiwi/core/sas.ts";
import type { ChannelState } from "@kiwi/core/state.ts";
import { isWakeVia, viaOf } from "@kiwi/core/wake.ts";
import { holding, isAnswer, MARK_EVERY_MS, type Agent, type Delivery, type Hearing } from "./shared.ts";
import { SessionState } from "./state.ts";
import { narrows } from "./wants.ts";

const BEACON_SLACK_MS = 5_000;

export class SessionListen extends SessionState {
  listen<R = never>(onMessage: (m: Message, state: ChannelState) => Effect.Effect<void | boolean, unknown, R>, opts: Delivery & Hearing<R>): Effect.Effect<void, Refused | ChannelGone, Agent | R> {
    return Effect.gen({ self: this }, function* () {
      yield* this.unheld;
      if (opts.hold !== false) yield* holding(this.alias, this.me, opts.marks !== false);
      const status = (line: string) => opts.onStatus?.(line) ?? Effect.void;
      const reached = yield* this.reach(status);
      const since = reached.since;
      let { messages, state } = reached;
      const cache = yield* Cache;
      const cursor = yield* Cursor;
      const seen = yield* cursor.seen(this.alias, this.me);
      const aside = <E, R2>(e: Effect.Effect<unknown, E, R2>) => Effect.forkScoped(Effect.ignoreCause(e));

      let readTo = 0;
      let saidTo = 0;
      let held = false;
      const narrowed = narrows(opts);
      let mark: ((seq: number) => boolean) | null = null;
      const away = yield* Deferred.make<void, Rejected>();
      const lost = Effect.flatMap(Effect.exit(this.unheld), (exit) => (Exit.isSuccess(exit) ? Effect.succeed(false) : Effect.as(Deferred.failCause(away, exit.cause), true)));
      const stillOurs = <A, E, R2>(e: Effect.Effect<A, E, R2>) => Effect.flatMap(lost, (gone) => (gone ? Effect.void : Effect.asVoid(e)));
      const hear = (m: Message) =>
        Effect.gen({ self: this }, function* () {
          if (m.seq > (messages.at(-1)?.seq ?? 0)) {
            messages = [...messages, m];
            yield* cache.append(this.cfg.roomId, [m]);
            state = yield* this.foldState(messages, yield* this.members());
            if (state.trust.get(m.seq) === "forged") state = yield* this.foldState(messages, yield* this.members(true));
          }
          const fresh = !seen.has(m.seq);
          const wanted = fresh && this.wants(m, state, opts);
          if (wanted && (yield* lost)) return;
          const delivered = wanted && (yield* onMessage(m, state)) !== false;
          if (delivered) readTo = m.seq;
          if (fresh && !delivered && (wanted || (narrowed && this.wants(m, state)))) held = true;
          if (yield* lost) return;
          if (!held) yield* cursor.write(this.alias, this.me, m.seq);
          else if (delivered) yield* cursor.markSeen(this.alias, this.me, [m.seq]);
        });

      const sayRead = Effect.sync(() => {
        if (readTo > saidTo && mark?.(readTo)) saidTo = readTo;
      });
      if (opts.marks !== false) {
        yield* Effect.forkScoped(Effect.forever(Effect.andThen(Effect.sleep(MARK_EVERY_MS), sayRead)));
        yield* Effect.addFinalizer(() => Effect.suspend(() => (readTo > saidTo ? this.markRead(readTo) : Effect.void)));
      }

      const opened = ({ mark: on, kind }: Extract<Live, { _tag: "Open" }>) =>
        Effect.gen({ self: this }, function* () {
          mark = on;
          if (kind === "page") return;
          yield* aside(this.members(true));
        });

      const handle = (ev: Live): Effect.Effect<void, unknown, Agent | R | Scoped.Scope> => {
        switch (ev._tag) {
          case "Open":
            return opened(ev);
          case "Message":
            return stillOurs(hear(ev.message));
          case "Roster":
            this.postingChecked = false;
            return aside(Effect.andThen(this.members(true), this.chores()));
          case "Request":
            return opts.onNotice ? stillOurs(aside(this.notices(opts.onNotice))) : Effect.void;
          default:
            return Effect.void;
        }
      };
      if (opts.onNotice) yield* aside(this.notices(opts.onNotice));
      yield* Effect.raceFirst(eachLive(this.ch.fx.live(since, { presence: false, reads: false }), handle, status), Deferred.await(away));
    }).pipe(Effect.scoped);
  }

  private ownerChannel() {
    return Effect.gen({ self: this }, function* (this: SessionListen) {
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
    return Effect.gen({ self: this }, function* (this: SessionListen) {
      const owner = yield* this.ownerChannel();
      if (!owner) return;
      const budget = (yield* Keystore).budget;
      for (const r of yield* owner.fx.requests({ budget })) {
        if (r.check === "ready") {
          yield* notice(`join request: "${r.name}" wants in, verification code ${r.code}. ` + `Only your human may approve, in the Channels app, after checking the code matches.`);
        } else if (r.check === "unchecked") {
          yield* notice(`join request: "${r.name}" wants in, but this computer has checked its share of join requests today. ${TOO_MANY_REQUESTS}`);
        }
      }
    });
  }

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
        if (isAnswer(err)) return yield* Effect.failCause(exit.cause);
        if (!told && Date.now() - downSince >= QUIET_DROP_MS) {
          told = true;
          yield* status(`can't reach the relay (${reason(err)}); still retrying`);
        }
        yield* Effect.sleep(backoff);
      }
    });
  }

  readonly who = Effect.fn("AgentSession.who")({ self: this }, function* (this: SessionListen, waitMs = 1_500) {
    const found = new Map<string, Presence>();
    const [cached, roster] = yield* Effect.all([Effect.promise(() => daemonPresence(this.alias, this.me)), this.members()], { concurrency: "unbounded" });
    const signed = (p: Presence & { sigOk: boolean }) => p.client !== "probe" && p.from !== this.me && p.sigOk && roster.find((r) => r.name === p.from && r.active)?.pk === p.pk;
    const keep = (p: Presence & { sigOk: boolean }) => {
      const { readAt, wake, ...rest } = p;
      found.set(p.from, {
        ...rest,
        ...(typeof readAt === "number" && Number.isFinite(readAt) ? { readAt } : {}),
        ...(isWakeVia(wake) ? { wake } : {}),
      });
    };
    const now = Date.now();
    if (cached && now - cached.since >= cached.beaconMs + BEACON_SLACK_MS) {
      for (const { presence, at } of cached.presence) if (signed(presence) && now - at <= 2 * cached.beaconMs + BEACON_SLACK_MS) keep(presence);
      return yield* this.withMine(found);
    }
    const head = yield* this.ch.fx.head();
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
        if (!signed(p)) return;
        if (!found.has(p.from)) yield* heard;
        keep(p);
      });
    const probing = eachLive(this.ch.fx.live(head, { presence: true, reads: false }), handle, () => Effect.void);
    yield* Effect.raceFirst(probing, Effect.raceFirst(Deferred.await(quiet), Effect.sleep(waitMs))).pipe(Effect.ignoreCause, Effect.scoped);
    return yield* this.withMine(found);
  });

  private withMine(found: Map<string, Presence>) {
    return Effect.gen({ self: this }, function* (this: SessionListen) {
      const mine = yield* Effect.promise(() => daemonSeat(this.alias, this.me));
      const myWake = mine?.wake.on ? viaOf(mine.wake.path) : null;
      if (mine)
        found.set(this.me, {
          v: PROTOCOL_VERSION,
          type: "presence",
          from: this.me,
          client: "daemon",
          ts: Date.now(),
          ...(isReach(mine.reach) ? { reach: mine.reach } : {}),
          ...(mine.read ? { readAt: mine.read.at } : {}),
          ...(myWake ? { wake: myWake } : {}),
        });
      return found;
    });
  }
}
