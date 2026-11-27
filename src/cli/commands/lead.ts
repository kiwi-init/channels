import * as Effect from "effect/Effect";
import type { ChannelState, Frozen } from "@kiwi/core/state.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out, readSession, session } from "../context.ts";

const USAGE = "usage: kiwi lead · kiwi lead standby NAME [--clear] · kiwi lead hand NAME";

export function dutyLines(state: Frozen<Pick<ChannelState, "lead" | "homeLead" | "duty" | "standbys">>): string[] {
  const standbys = [...state.standbys.keys()].sort();
  const home = state.duty && state.homeLead && state.homeLead !== state.lead ? ` (the channel's own lead: ${state.homeLead})` : "";
  return [
    `lead on duty: ${state.lead ?? "nobody"}${home}`,
    `assignment: ${state.duty ? `#${state.duty.since}, by ${state.duty.by}` : "the channel's own lead, never handed over"}`,
    `standby leads: ${standbys.length ? standbys.join(", ") : "none approved"}`,
  ];
}

export const leadCommands: Record<string, Command> = {
  lead: () =>
    Effect.gen(function* () {
      const sub = args[1];
      if (sub === undefined) {
        const s = yield* readSession();
        return out(dutyLines((yield* s.state()).state).join("\n"));
      }
      const name = args[2] ?? (yield* die(USAGE));
      if (sub === "standby") {
        const s = yield* session();
        const after = yield* s.standbyLead(name, !opt.clear);
        return out(dutyLines(after).join("\n"));
      }
      if (sub === "hand") {
        const s = yield* session();
        const after = yield* s.handLead(name);
        return out(dutyLines(after).join("\n"));
      }
      return yield* die(USAGE);
    }),
};
