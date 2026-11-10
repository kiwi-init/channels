import { inlineText } from "./membership.ts";
import { channelOwner, moverOf } from "./mover.ts";
import type { NudgeStep } from "./protocol.ts";
import { actOf, memberKey, partyOfKey, queuedKey, QUEUE_MS, QUIET_MS, rolled } from "./state/clocks.ts";
import { isPerson } from "./state/people.ts";
import type { ChannelState, Task } from "./state/types.ts";
import { spanText } from "./steps.ts";

type Board = Pick<ChannelState, "tasks" | "members" | "lead" | "openAsks" | "github" | "branchPrefix">;

export interface Clock {
  mover: string;
  party: string;
  epoch: number;
  since: number;
  quiet: number;
  paged: boolean;
  step: 0 | 1 | 2 | 3;
}

export function clockOf(state: Board, t: Task, now: number): Clock | undefined {
  const c = rolled(state, t, now);
  const mover = moverOf(state, t, now);
  if (!c || mover?.kind !== "member") return undefined;
  const member = state.members.get(mover.name);
  const paged = memberKey(c.key) && !!member && !isPerson(member);
  const own = actOf(c, mover.name);
  const start = own ?? { seq: c.seq, at: c.at };
  return { mover: mover.name, party: partyOfKey(c.key), epoch: start.seq, since: start.at, quiet: Math.max(0, now - start.at), paged, step: own ? 0 : (c.step ?? 0) };
}

export interface NudgeDue {
  task: number;
  mover: string;
  since: number;
  step: NudgeStep;
  day?: number;
  to: string | undefined;
}

const leadHere = (state: Board): string | undefined => (state.lead && state.members.get(state.lead)?.active ? state.lead : undefined);

function target(state: Board, mover: string, step: 1 | 2 | 3): string | undefined {
  if (step === 1) return mover;
  const lead = leadHere(state);
  return step === 2 && lead && lead !== mover ? lead : channelOwner(state);
}

const ladderStep = (quiet: number, every: number): 0 | 1 | 2 | 3 => (quiet >= 3 * every ? 3 : quiet >= 2 * every ? 2 : quiet >= every ? 1 : 0);

function quietDue(state: Board, t: Task, now: number, every: number): NudgeDue[] {
  const clock = clockOf(state, t, now);
  if (!clock?.paged) return [];
  const step = ladderStep(clock.quiet, every);
  if (step === 0 || clock.step >= step) return [];
  return [{ task: t.id, mover: clock.party, since: clock.epoch, step, to: target(state, clock.mover, step) }];
}

function queueDue(state: Board, now: number): NudgeDue[] {
  const oldest = new Map<string, { t: Task; seq: number; at: number; day: number }>();
  for (const t of state.tasks.values()) {
    const c = t.state === "todo" ? rolled(state, t, now) : undefined;
    if (!c || !queuedKey(c.key)) continue;
    const owner = partyOfKey(c.key);
    const who = state.members.get(owner);
    if (!who || !who.active || isPerson(who)) continue;
    const first = oldest.get(owner);
    if (!first || t.id < first.t.id) oldest.set(owner, { t, seq: c.seq, at: c.at, day: c.day ?? 0 });
  }
  return [...oldest].flatMap(([owner, q]): NudgeDue[] => {
    const day = Math.floor((now - q.at) / QUEUE_MS);
    return day < 1 || day <= q.day ? [] : [{ task: q.t.id, mover: owner, since: q.seq, step: 0, day, to: leadHere(state) ?? channelOwner(state) }];
  });
}

export function nudgesDue(state: Board, now: number, every: number = QUIET_MS): NudgeDue[] {
  const open = [...state.tasks.values()].filter((t) => t.state !== "done" && !t.archived);
  return [...open.flatMap((t) => quietDue(state, t, now, every)), ...queueDue(state, now)];
}

const DUE_WORDS = ["", "a wake is due", "due to the lead", "due in the owner's Needs you"] as const;

export function quietText(clock: Clock, every: number = QUIET_MS): string | undefined {
  if (!clock.paged || clock.quiet < every) return undefined;
  return `quiet ${spanText(clock.quiet)} with ${inlineText(clock.mover, 40)}${clock.step ? ` (${DUE_WORDS[clock.step]})` : ""}`;
}
