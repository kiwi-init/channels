import { inlineText } from "./membership.ts";
import { channelOwner, moverOf, type Mover } from "./mover.ts";
import type { NudgeStep } from "./protocol.ts";
import { isPerson, type ChannelState, type Task } from "./state.ts";
import { nudgedAt, nudgedUpTo, QUEUE_MS, QUIET_MS } from "./state/nudges.ts";
import { spanText } from "./steps.ts";

type Board = Pick<ChannelState, "tasks" | "members" | "lead" | "openAsks" | "github">;
type MemberMove = Extract<Mover, { kind: "member" }>;

export interface Clock {
  mover: string;
  since: number;
  quiet: number;
  paged: boolean;
}

function startOf(state: Board, t: Task, mover: MemberMove, now: number): number {
  const times = [t.createdAt, t.movedAt ?? 0, t.released ?? 0, t.touched?.[mover.name] ?? 0];
  for (const r of t.rounds) {
    times.push(r.ts);
    if (r.result.kind === "approved" || r.result.kind === "rejected") times.push(r.result.ts);
  }
  for (const s of t.steps ?? []) {
    if (s.progress.kind === "ended") times.push(s.progress.end.ts);
    else {
      if (s.wait?.until !== undefined && s.wait.until <= now) times.push(s.wait.until);
      if (s.run?.due !== undefined && s.run.due <= now) times.push(s.run.due);
    }
  }
  const question = mover.question === undefined ? undefined : state.openAsks.find((a) => a.seq === mover.question);
  if (question) times.push(question.rts ?? question.ts);
  return Math.max(...times);
}

export function clockOf(state: Board, t: Task, now: number): Clock | undefined {
  const mover = moverOf(state, t, now);
  if (mover?.kind !== "member") return undefined;
  const since = startOf(state, t, mover, now);
  const member = state.members.get(mover.name);
  return { mover: mover.name, since, quiet: Math.max(0, now - since), paged: !!member && !isPerson(member) };
}

export interface NudgeDue {
  task: number;
  mover: string;
  since: number;
  step: NudgeStep;
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
  if (step === 0 || nudgedUpTo(t, clock.mover, clock.since) >= step) return [];
  return [{ task: t.id, mover: clock.mover, since: clock.since, step, to: target(state, clock.mover, step) }];
}

function queueDue(state: Board, now: number): NudgeDue[] {
  const oldest = new Map<string, Task>();
  for (const t of state.tasks.values()) {
    const mover = t.state === "todo" ? moverOf(state, t, now) : undefined;
    if (mover?.kind !== "waiting") continue;
    const first = oldest.get(mover.owner);
    if (!first || t.id < first.id) oldest.set(mover.owner, t);
  }
  return [...oldest].flatMap(([owner, t]): NudgeDue[] => {
    const from = Math.max(t.createdAt, t.movedAt ?? 0);
    const days = Math.floor((now - from) / QUEUE_MS);
    const since = from + days * QUEUE_MS;
    if (days < 1 || nudgedAt(t, { mover: owner, since, step: 0 })) return [];
    return [{ task: t.id, mover: owner, since, step: 0, to: leadHere(state) ?? channelOwner(state) }];
  });
}

export function nudgesDue(state: Board, now: number, every: number = QUIET_MS): NudgeDue[] {
  const open = [...state.tasks.values()].filter((t) => t.state !== "done" && !t.archived);
  return [...open.flatMap((t) => quietDue(state, t, now, every)), ...queueDue(state, now)];
}

const NUDGE_WORDS = ["", "woken", "the lead was told", "in the owner's Needs you"] as const;

export function quietText(t: Pick<Task, "nudged">, clock: Clock, every: number = QUIET_MS): string | undefined {
  if (!clock.paged || clock.quiet < every) return undefined;
  const reached = nudgedUpTo(t, clock.mover, clock.since);
  return `quiet ${spanText(clock.quiet)} with ${inlineText(clock.mover, 40)}${reached ? ` (${NUDGE_WORDS[reached]})` : ""}`;
}
