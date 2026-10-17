import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ChannelGone } from "@kiwi/core/client.ts";
import { Keystore } from "../config.ts";
import { here, kimiHookHere, sameSeat, seatsHeldAnywhere, type Here } from "../seats.ts";
import { answer, hookOutput, kimiReason, tellKimi, type HookInput } from "./answer.ts";
import { listen, type Served } from "./listen.ts";
import { refreshListeners, seatsFor } from "./listeners.ts";
import { KIMI_STOP, LISTEN } from "./self.ts";

const HOOK_MS = 15_000;
const SEAT_ANSWER_MS = HOOK_MS - 1_000;

const say = (text: string) => Effect.sync(() => void process.stdout.write(text));

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
  yield* Effect.promise(() => refreshListeners());
  const project = seatsFor(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd(), { who });
  const near = project.length ? project : seatsFor(input.cwd ?? process.cwd(), { who });
  const seats = [...near, ...seatsHeldAnywhere(who)].filter((b, i, all) => all.findIndex((o) => sameSeat(o, b)) === i);
  const keys = yield* Keystore;
  const channels = (yield* keys.config).channels;
  const served = seats.flatMap((b): Served[] => {
    const cfg = channels[b.alias];
    return cfg ? [{ b, cfg }] : [];
  });
  if (!served.length) return 0;
  if (event === LISTEN) return yield* listen(served, who).pipe(Effect.scoped, Effect.catchCause(() => Effect.succeed(0)));
  const one = ({ b, cfg }: Served) => answer(kimi ? "stop" : event, input, b, cfg, who).pipe(
    Effect.catchCause((cause) => {
      const err = Cause.squash(cause);
      if (err instanceof ChannelGone) return Effect.as(err.why === "closed" ? keys.wipeChannel(b.alias) : keys.forgetMember(b.alias, b.as), null);
      return Effect.succeed(null);
    }),
    Effect.timeoutOption(SEAT_ANSWER_MS),
    Effect.map(Option.getOrNull),
  );
  const work = Effect.flatMap(Effect.forEach(served, one, { concurrency: "unbounded" }), (answers) => {
    const got = answers.filter((a) => a !== null);
    if (kimi) return got.length ? Effect.sync(() => tellKimi(kimiReason(got))) : Effect.succeed(0);
    const out = hookOutput(got);
    return out === null ? Effect.succeed(0) : Effect.as(say(out), 0);
  });
  return yield* Effect.raceFirst(work, Effect.as(Effect.sleep(HOOK_MS), 0));
});
