import * as Effect from "effect/Effect";
import { heldSteps, offDutyLines, offDutySince, takenOverLines } from "@kiwi/core/duty.ts";
import type { ChannelState, Frozen } from "@kiwi/core/state.ts";
import { stepText } from "@kiwi/core/steps.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out, readSession, session } from "../context.ts";
import { readText } from "../input.ts";

const USAGE = "usage: kiwi lead · kiwi lead standby NAME [--clear] · kiwi lead hand NAME [--file checkpoint.md]";

export function dutyLines(state: Frozen<Pick<ChannelState, "lead" | "homeLead" | "duty" | "standbys">>): string[] {
  const standbys = [...state.standbys.keys()].sort();
  const home = state.duty && state.homeLead && state.homeLead !== state.lead ? ` (the channel's own lead: ${state.homeLead})` : "";
  return [
    `lead on duty: ${state.lead ?? "nobody"}${home}`,
    `assignment: ${state.duty ? `#${state.duty.since}, by ${state.duty.by}` : "the channel's own lead, never handed over"}`,
    `standby leads: ${standbys.length ? standbys.join(", ") : "none approved"}`,
  ];
}

function holdLines(state: Frozen<Pick<ChannelState, "tasks">>): string[] {
  const holds = heldSteps(state);
  return holds.length ? ["holds on delivery:", ...holds.map((h) => `  T${h.task.id} ${stepText(h.step)}: held by ${h.hold.by} (#${h.hold.seq}): ${h.hold.reason}`)] : [];
}

export function handLines(after: Frozen<ChannelState>, name: string, seq: number, now: number): string[] {
  const left = offDutySince(after, name);
  return [...dutyLines(after), ...takenOverLines(after, after.lead ?? name, now), ...(left !== undefined && left < seq ? offDutyLines(after, left, seq) : [])];
}

export const leadCommands: Record<string, Command> = {
  lead: () =>
    Effect.gen(function* () {
      const sub = args[1];
      if (sub === undefined) {
        const s = yield* readSession();
        const { state } = yield* s.state();
        return out([...dutyLines(state), ...holdLines(state)].join("\n"));
      }
      const name = args[2] ?? (yield* die(USAGE));
      if (sub === "standby") {
        const s = yield* session();
        const after = yield* s.standbyLead(name, !opt.clear);
        return out(dutyLines(after).join("\n"));
      }
      if (sub === "hand") {
        const s = yield* session();
        const checkpoint = opt.file !== undefined ? yield* readText(opt.file) : undefined;
        const { after, seq } = yield* s.handLead(name, checkpoint);
        return out(handLines(after, name, seq, Date.now()).join("\n"));
      }
      return yield* die(USAGE);
    }),
};
