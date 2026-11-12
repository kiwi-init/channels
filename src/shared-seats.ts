import * as Effect from "effect/Effect";
import type { SharedSeat, SharedWork } from "@kiwi/core/shared-seats.ts";
import { openRound, taskId, type ChannelState } from "@kiwi/core/state.ts";
import { openSession } from "./agent.ts";
import type { Config } from "./config.ts";
import { sessionNeighbours } from "./seats.ts";

export function inFlight(state: Pick<ChannelState, "tasks">, name: string): SharedWork[] {
  return [...state.tasks.values()].flatMap((t): SharedWork[] => {
    const round = t.state === "review" && t.review === name ? openRound(t) : undefined;
    if (round) return [{ kind: "review", task: t.id, round: round.n }];
    return t.owner === name && t.state === "doing" ? [{ kind: "doing", task: t.id }] : [];
  });
}

export const workText = (w: SharedWork): string => (w.kind === "review" ? `round ${w.round} of ${taskId(w.task)} to review` : `${taskId(w.task)} in progress`);

export const sharedSeats = (cfg: Config, only?: string) =>
  Effect.gen(function* () {
    const out: SharedSeat[] = [];
    for (const alias of Object.keys(cfg.channels).filter((a) => only === undefined || a === only)) {
      const here = cfg.channels[alias];
      if (!here) continue;
      for (const [agent, others] of sessionNeighbours(cfg, alias)) {
        const shared: SharedSeat["with"] = [];
        for (const o of others) {
          const there = cfg.channels[o.alias];
          if (!there) continue;
          const state = yield* openSession(o.alias, there, o.as).pipe(
            Effect.flatMap((x) => x.state()),
            Effect.map((r) => r.state),
            Effect.catchCause(() => Effect.succeed(null)),
          );
          shared.push({ room: there.roomId, alias: o.alias, agent: o.as, work: state ? inFlight(state, o.as) : [] });
        }
        if (shared.length) out.push({ room: here.roomId, alias, agent, with: shared });
      }
    }
    return out;
  });

export function sharedLines(seats: readonly SharedSeat[]): string[] {
  return seats.flatMap((s) =>
    s.with.map((o) => `${s.agent} runs in one session with @${o.agent} in "${o.alias}"${o.work.length ? `, which has ${o.work.map(workText).join(", ")}: resetting the session loses that` : ""}`),
  );
}
