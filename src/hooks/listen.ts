import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import { randomUUID } from "node:crypto";
import { writeSync } from "node:fs";
import { openSession } from "../agent.ts";
import { Cursor, home, loadConfig, type ChannelConfig } from "../config.ts";
import { wakeOn } from "../daemon/reach.ts";
import { appendWakeRow } from "../daemon/wake.ts";
import { formatMessage, messageHead } from "@kiwi/core/format.ts";
import type { Binding, Here } from "../seats.ts";
import { handOver, seatBudget } from "./answer.ts";
import { answeringNow, deliveredInProcess, noteDelivered, noteHeard, notePending, settlePending } from "./delivered.ts";
import { hooksListen, installedListenSeconds } from "./install/claude.ts";
import { loopDelivery } from "./loop-wait.ts";
import { mimoInstalled } from "./install/mimo.ts";
import { piInstalled } from "./install/pi.ts";
import { alive, isListening, takeListenSlot } from "./listeners.ts";
import { LISTEN_SECONDS, mcFor } from "./self.ts";

export interface Served {
  b: Binding;
  cfg: ChannelConfig;
}

export function listenHead(alias: string, mc: string, share: number): string {
  const full = `New Kiwi Channels messages for you (${alias}). Handle them; answer with \`${mc} reply N "…"\`:`;
  if (full.length + 2 <= share) return full;
  const short = `New Kiwi Channels messages (${alias}):`;
  return short.length + 2 <= share ? short : short.slice(0, Math.max(0, share - 2));
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
  const quiet = yield* loopDelivery(s);
  const real = yield* Cursor;
  let at = Math.max(yield* s.cursor(), deliveredInProcess(b.alias, b.as, who.session ?? "", who.harness === "claude" ? who.pid : undefined));
  const from = at;
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
        ...quiet,
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
  return { b, got, hearing, dropShown, from, reached: () => at, still: s.unheld };
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

export type Handoff = { kind: "at-once" } | { kind: "acked"; landed: string | null };

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function handoffFrom(landed: unknown): Handoff {
  if (landed === undefined) return { kind: "at-once" };
  return { kind: "acked", landed: typeof landed === "string" && TOKEN.test(landed) ? landed : null };
}

export interface Refused {
  tries: number;
  error: string;
}

export function refusedFrom(value: unknown): Refused | null {
  if (typeof value !== "object" || value === null) return null;
  const tries = "tries" in value ? value.tries : undefined;
  const error = "error" in value ? value.error : undefined;
  if (typeof tries !== "number" || !Number.isInteger(tries) || tries < 1 || typeof error !== "string") return null;
  return { tries, error: error.replace(/\s+/g, " ").trim().slice(0, 200) };
}

function refusedWhy({ tries, error }: Refused): string {
  return `MiMoCode refused the wake ${tries === 1 ? "once" : `${tries} times`} before it landed: ${error || "no reason given"}`;
}

export const listen = Effect.fn("Hooks.listen")(function* (served: readonly Served[], who: Here, handoff: Handoff, refused: Refused | null = null) {
  const extension = who.harness === "pi" || who.harness === "mimo";
  const via = who.harness === "mimo" ? "mimo-plugin" : who.harness === "pi" ? "pi-extension" : null;
  if (handoff.kind === "acked" && handoff.landed !== null)
    for (const { b } of served) {
      const settled = settlePending(b.alias, b.as, who.session ?? "", handoff.landed);
      if (settled !== null && refused && via) appendWakeRow(home(), { at: Date.now(), alias: b.alias, agent: b.as, via, unread: 0, result: "failed", why: refusedWhy(refused), cursor: settled });
    }
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
  const ours = yield* Effect.forEach(armed, (a) => Effect.map(Effect.exit(a.still), Exit.isSuccess));
  const withNews = armed.filter((a, i) => a.got.length && ours[i]);
  if (!withNews.length && armed.some((a) => a.got.length)) return 0;
  const share = seatBudget(withNews.length);
  const told = withNews.map((a) => {
    const mc = mcFor(a.b.alias, a.b.as, process.cwd(), who);
    const head = listenHead(a.b.alias, mc, share);
    const hand = handOver(
      a.got.map((g) => ({ line: g.text, seq: g.seq ?? 0, head: g.head })),
      Math.max(0, share - head.length - 2),
      mc,
    );
    const shown = a.got.slice(0, hand.count);
    const rest = a.got.slice(hand.count).filter((g) => g.seq !== null).length;
    const seqs = shown.flatMap((g) => (g.seq === null ? [] : [g.seq]));
    return { b: a.b, seqs, from: a.from, upTo: rest ? Math.max(0, ...seqs) : a.reached(), text: hand.text, head };
  });
  if (extension && !told.length) return 0;
  const blocks = told.map(({ head, text }) => `${head}\n${text}\n`);
  const token = randomUUID();
  if (handoff.kind === "acked") for (const { b, upTo } of told) notePending(b.alias, b.as, who.session ?? "", token, upTo);
  try {
    if (handoff.kind === "acked") writeSync(1, token);
    writeSync(2, blocks.length ? blocks.join("\n") : "Kiwi Channels: a day with no messages for you. Nothing to do; just end your turn.\n");
  } catch {
    return 0;
  }
  for (const { b, upTo, seqs, from } of told) {
    if (handoff.kind === "at-once") noteDelivered(b.alias, b.as, who.session ?? "", upTo, who.harness === "claude" ? who.pid : undefined);
    noteHeard(who.session, b.alias, b.as, seqs);
    if (via) appendWakeRow(home(), { at: Date.now(), alias: b.alias, agent: b.as, via, unread: seqs.length, result: "handed", why: null, cursor: from });
  }
  return 2;
});
