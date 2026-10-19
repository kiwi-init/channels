import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ChannelGone } from "@kiwi/core/client.ts";
import { Keystore } from "../config.ts";
import { here, kimiHookHere, sameSeat, seatsHeldAnywhere, type Here } from "../seats.ts";
import { writeSync } from "node:fs";
import { answer, hookOutput, kimiReason, printed, tellKimi, type Answer, type HookInput } from "./answer.ts";
import { holdAnswering } from "./delivered.ts";
import { listen, type Served } from "./listen.ts";
import { refreshListeners, seatsFor } from "./listeners.ts";
import { KIMI_STOP, LISTEN } from "./self.ts";

const HOOK_MS = 1_800;
const START_MS = 5_000;

const say = (text: string) => Effect.sync(() => void writeSync(1, text));

export const runHook = Effect.fn("Hooks.run")(function* (event: string) {
  const raw = yield* Effect.promise(() => new Response(Bun.stdin.stream()).text().catch(() => ""));
  let input: HookInput = {};
  try {
    input = JSON.parse(raw) as HookInput;
  } catch {
    // Empty or not JSON on stdin: the hook goes by its environment alone.
  }
  const kimi = event === KIMI_STOP;
  const model = typeof input.model === "string" && input.model.trim() ? input.model.trim() : undefined;
  const who: Here = kimi ? kimiHookHere() : { ...here(), ...(input.session_id ? { session: input.session_id } : {}), ...(model ? { model } : {}) };
  const release = event === LISTEN ? () => {} : holdAnswering(who.session);
  const deadline = event === "session-start" || kimi ? START_MS : HOOK_MS;
  const keys = yield* Keystore;
  const seatsServed = Effect.gen(function* () {
    yield* Effect.promise(() => refreshListeners());
    const project = seatsFor(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd(), { who });
    const near = project.length ? project : seatsFor(input.cwd ?? process.cwd(), { who });
    const seats = [...near, ...seatsHeldAnywhere(who)].filter((b, i, all) => all.findIndex((o) => sameSeat(o, b)) === i);
    const channels = (yield* keys.config).channels;
    return seats.flatMap((b): Served[] => {
      const cfg = channels[b.alias];
      return cfg ? [{ b, cfg }] : [];
    });
  });
  if (event === LISTEN) {
    const served = yield* seatsServed;
    if (!served.length) return 0;
    return yield* listen(served, who).pipe(
      Effect.scoped,
      Effect.catchCause(() => Effect.succeed(0)),
    );
  }
  const one = ({ b, cfg }: Served) =>
    answer(kimi ? "stop" : event, input, b, cfg, who).pipe(
      Effect.catchCause((cause) => {
        const err = Cause.squash(cause);
        if (err instanceof ChannelGone) return Effect.as(err.why === "closed" ? keys.wipeChannel(b.alias) : keys.forgetMember(b.alias, b.as), null);
        return Effect.succeed(null);
      }),
      Effect.timeoutOption(deadline - 300),
      Effect.map(Option.getOrNull),
    );
  const shown = (answers: readonly Answer[]) => Effect.forEach(answers, (a) => a.shown, { discard: true, concurrency: "unbounded" });
  const work = Effect.gen(function* () {
    const served = yield* seatsServed;
    const got = (yield* Effect.forEach(served, one, { concurrency: "unbounded" })).filter((a) => a !== null);
    if (kimi) {
      if (!got.length) return 0;
      const code = tellKimi(kimiReason(got));
      if (code) yield* shown(got);
      return code;
    }
    const out = hookOutput(got);
    if (out === null) return 0;
    yield* say(out).pipe(
      Effect.andThen(shown(printed(got))),
      Effect.catchCause(() => Effect.void),
    );
    return 0;
  });
  return yield* Effect.raceFirst(work, Effect.as(Effect.sleep(deadline), 0)).pipe(Effect.ensuring(Effect.sync(release)));
});
