import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import { writeSync } from "node:fs";
import { openSession } from "../agent.ts";
import { Cursor, loadConfig, type ChannelConfig } from "../config.ts";
import { wakeOn } from "../daemon/reach.ts";
import { formatMessage, messageHead } from "@kiwi/core/format.ts";
import type { Binding, Here } from "../seats.ts";
import { handOver, seatBudget } from "./answer.ts";
import { answeringNow, deliveredUpTo, noteDelivered, noteHeard } from "./delivered.ts";
import { hooksListen, installedListenSeconds } from "./install/claude.ts";
import { mimoInstalled } from "./install/mimo.ts";
import { piInstalled } from "./install/pi.ts";
import { alive, isListening, takeListenSlot } from "./listeners.ts";
import { LISTEN_SECONDS, mcFor } from "./self.ts";

export interface Served {
  b: Binding;
  cfg: ChannelConfig;
}

function listenHead(alias: string, mc: string): string {
  return `New Kiwi Channels messages for you (${alias}). Handle them; answer with \`${mc} reply N "…"\`:`;
}

interface Heard {
  seq: number | null;
  text: string;
  head: number;
}

const ANSWERED_WAIT_MS = 20_000;
const SLOT_RETRY_FIRST_MS = 2_000;
const SLOT_RETRY_MAX_MS = 60_000;

const tune = Effect.fn("Hooks.tune")(function* ({ b, cfg }: Served, who: Here, woke: Effect.Effect<void, never, Scope.Scope>) {
  const s = yield* openSession(b.alias, cfg, b.as);
  const real = yield* Cursor;
  let at = Math.max(yield* s.cursor(), deliveredUpTo(b.alias, b.as, who.session ?? ""));
  const peek = Cursor.of({ read: () => Effect.succeed(at), write: (_c, _a, seq) => Effect.sync(() => void (at = Math.max(at, seq))), seen: real.seen, markSeen: () => Effect.void });
  const got: Heard[] = [];
  const hearing = s
    .listen(
      (m, state) =>
        Effect.andThen(
          Effect.sync(() => void got.push({ seq: m.seq, text: formatMessage(m, state.trust.get(m.seq), state, s.me), head: messageHead(m, state.trust.get(m.seq), state, s.me).length + 2 })),
          woke,
        ),
      {
        onNotice: (text) =>
          Effect.andThen(
            Effect.sync(() => void got.push({ seq: null, text: `* ${text}`, head: text.length + 2 })),
            woke,
          ),
        marks: false,
      },
    )
    .pipe(Effect.provideService(Cursor, peek));
  const dropShown = Effect.gen(function* () {
    const shown = (yield* real.read(b.alias, b.as)) ?? 0;
    const seen = yield* real.seen(b.alias, b.as);
    const left = got.filter((g) => g.seq === null || (g.seq > shown && !seen.has(g.seq)));
    got.splice(0, got.length, ...left);
    at = Math.max(at, shown);
  });
  return { b, got, hearing, dropShown, reached: () => at };
});

const arm = Effect.fn("Hooks.arm")(function* (seat: Served, who: Here, woke: Effect.Effect<void, never, Scope.Scope>) {
  const { b } = seat;
  if (!wakeOn(loadConfig(), b.alias, b.as) || isListening(b.alias, b.as)) return null;
  const slot = yield* Effect.promise(() => takeListenSlot(b.alias, b.as, who.session ?? "")).pipe(
    Effect.repeat({
      while: (got) => got === "unreachable" && (!who.pid || alive(who.pid)),
      schedule: Schedule.min([Schedule.exponential(SLOT_RETRY_FIRST_MS), Schedule.spaced(SLOT_RETRY_MAX_MS)]),
    }),
  );
  if (typeof slot === "string") return null;
  const release = () => slot.close();
  yield* Effect.addFinalizer(() => Effect.sync(release));
  return yield* tune(seat, who, woke).pipe(
    Effect.map((tuned) => ({ ...tuned, release })),
    Effect.catchCause(() => Effect.sync(() => (release(), null))),
  );
});

export const listen = Effect.fn("Hooks.listen")(function* (served: readonly Served[], who: Here) {
  const extension = who.harness === "pi" || who.harness === "mimo";
  if (who.harness === "pi" ? !piInstalled() : who.harness === "mimo" ? !mimoInstalled() : !hooksListen()) return 0;
  let enough = yield* Deferred.make<void>();
  let heard = 0;
  const woke = Effect.suspend(() => {
    heard += 1;
    return heard === 1 ? Effect.asVoid(Effect.forkScoped(Effect.andThen(Effect.sleep(400), Deferred.succeed(enough, undefined)))) : Effect.void;
  });
  const armed = (yield* Effect.forEach(served, (seat) => arm(seat, who, woke).pipe(Effect.catchCause(() => Effect.succeed(null))))).filter((a) => a !== null);
  let failed = 0;
  const hear = ({ hearing, release }: (typeof armed)[number]) =>
    Effect.as(hearing, "heard" as const).pipe(
      Effect.catchCause(() =>
        Effect.suspend(() => {
          release();
          failed += 1;
          return failed === armed.length ? Effect.succeed("failed" as const) : Effect.never;
        }),
      ),
    );
  const [first, ...rest] = armed.map(hear);
  if (!first) return 0;
  const hearing = rest.reduce((all, h) => Effect.raceFirst(all, h), first);
  const sessionGone = who.pid
    ? Effect.repeat(
        Effect.sync(() => alive(who.pid!)),
        { while: (up) => up, schedule: Schedule.spaced("2 seconds") },
      )
    : Effect.never;
  const answered = Effect.repeat(
    Effect.sync(() => answeringNow(who.session)),
    { while: (busy) => busy, schedule: Schedule.spaced("50 millis") },
  ).pipe(Effect.timeoutOption(ANSWERED_WAIT_MS));
  const installed = installedListenSeconds();
  const dayEnds = Date.now() + Math.min(LISTEN_SECONDS, installed === null ? LISTEN_SECONDS : installed - 60) * 1000;
  for (;;) {
    const ended = yield* Effect.raceFirst(
      hearing,
      Effect.raceFirst(
        Effect.as(Deferred.await(enough), "settled" as const),
        Effect.raceFirst(Effect.as(Effect.sleep(Math.max(0, dayEnds - Date.now())), "day" as const), Effect.as(sessionGone, "gone" as const)),
      ),
    ).pipe(Effect.scoped);
    if (ended === "gone" || ended === "failed" || (who.pid && !alive(who.pid))) return 0;
    yield* answered;
    for (const a of armed) yield* a.dropShown;
    if (ended !== "settled" || armed.some((a) => a.got.length)) break;
    heard = 0;
    enough = yield* Deferred.make<void>();
  }
  const withNews = armed.filter((a) => a.got.length);
  const share = seatBudget(withNews.length);
  const told = withNews.map((a) => {
    const mc = mcFor(a.b.alias, a.b.as, process.cwd(), who);
    const head = listenHead(a.b.alias, mc);
    const hand = handOver(
      a.got.map((g) => ({ line: g.text, seq: g.seq ?? 0, head: g.head })),
      Math.max(0, share - head.length - 2),
      mc,
    );
    const shown = a.got.slice(0, hand.count);
    const rest = a.got.slice(hand.count).filter((g) => g.seq !== null).length;
    const seqs = shown.flatMap((g) => (g.seq === null ? [] : [g.seq]));
    return { b: a.b, seqs, upTo: rest ? Math.max(0, ...seqs) : a.reached(), text: hand.text, head };
  });
  if (extension && !told.length) return 0;
  const blocks = told.map(({ head, text }) => `${head}\n${text}\n`);
  try {
    writeSync(2, blocks.length ? blocks.join("\n") : "Kiwi Channels: a day with no messages for you. Nothing to do; just end your turn.\n");
  } catch {
    return 0;
  }
  for (const { b, upTo, seqs } of told) {
    noteDelivered(b.alias, b.as, who.session ?? "", upTo);
    noteHeard(who.session, b.alias, b.as, seqs);
  }
  return 2;
});
