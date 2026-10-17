import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import { writeSync } from "node:fs";
import { openSession } from "../agent.ts";
import { Cursor, loadConfig, type ChannelConfig } from "../config.ts";
import { wakeOn } from "../daemon/reach.ts";
import { formatMessage } from "@kiwi/core/format.ts";
import type { Binding, Here } from "../seats.ts";
import { MAX_CONTEXT } from "./answer.ts";
import { deliveredUpTo, noteDelivered } from "./delivered.ts";
import { hooksListen } from "./install/claude.ts";
import { alive, isListening, takeListenSlot } from "./listeners.ts";
import { LISTEN_SECONDS, mcFor } from "./self.ts";

export interface Served {
  b: Binding;
  cfg: ChannelConfig;
}

const tune = Effect.fn("Hooks.tune")(function* ({ b, cfg }: Served, who: Here, woke: Effect.Effect<void, never, Scope.Scope>) {
  const s = yield* openSession(b.alias, cfg, b.as);
  const real = yield* Cursor;
  let at = Math.max(yield* s.cursor(), deliveredUpTo(b.alias, b.as, who.session ?? ""));
  const peek = Cursor.of({ read: () => Effect.succeed(at), write: (_c, _a, seq) => Effect.sync(() => void (at = Math.max(at, seq))), seen: real.seen, markSeen: () => Effect.void });
  const got: string[] = [];
  const hearing = s
    .listen(
      (m, state) =>
        Effect.andThen(
          Effect.sync(() => void got.push(formatMessage(m, state.trust.get(m.seq), state, s.me))),
          woke,
        ),
      {
        onNotice: (text) =>
          Effect.andThen(
            Effect.sync(() => void got.push(`* ${text}`)),
            woke,
          ),
        marks: false,
      },
    )
    .pipe(Effect.provideService(Cursor, peek));
  return { b, got, hearing, reached: () => at };
});

const arm = Effect.fn("Hooks.arm")(function* (seat: Served, who: Here, woke: Effect.Effect<void, never, Scope.Scope>) {
  const { b } = seat;
  if (!wakeOn(loadConfig(), b.alias, b.as) || isListening(b.alias, b.as)) return null;
  const slot = yield* Effect.promise(() => takeListenSlot(b.alias, b.as, who.session ?? ""));
  if (!slot) return null;
  const release = () => slot.close();
  yield* Effect.addFinalizer(() => Effect.sync(release));
  return yield* tune(seat, who, woke).pipe(
    Effect.map((tuned) => ({ ...tuned, release })),
    Effect.catchCause(() => Effect.sync(() => (release(), null))),
  );
});

export const listen = Effect.fn("Hooks.listen")(function* (served: readonly Served[], who: Here) {
  if (!hooksListen()) return 0;
  const enough = yield* Deferred.make<void>();
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
  const ended = yield* Effect.raceFirst(
    hearing,
    Effect.raceFirst(Effect.as(Deferred.await(enough), "heard" as const), Effect.raceFirst(Effect.as(Effect.sleep(LISTEN_SECONDS * 1000), "day" as const), Effect.as(sessionGone, "gone" as const))),
  ).pipe(Effect.scoped);
  if (ended === "gone" || ended === "failed" || (who.pid && !alive(who.pid))) return 0;
  const told = armed.filter((a) => a.got.length);
  const blocks = told.map(({ b, got }) => {
    const mc = mcFor(b.alias, b.as, process.cwd(), who);
    const text = got.join("\n");
    return `New Kiwi Channels messages for you (${b.alias}). Handle them; answer with \`${mc} reply N "…"\`:\n${text.length > MAX_CONTEXT ? `${text.slice(0, MAX_CONTEXT)}\n… (more: run \`${mc} log\`)` : text}\n`;
  });
  try {
    writeSync(2, blocks.length ? blocks.join("\n") : "Kiwi Channels: a day with no messages for you. Nothing to do; just end your turn.\n");
  } catch {
    return 0;
  }
  for (const { b, reached } of told) noteDelivered(b.alias, b.as, who.session ?? "", reached());
  return 2;
});
