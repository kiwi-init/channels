import { inlineText } from "./membership.ts";
import { isPerson } from "./state/people.ts";
import { landerOf, openRound } from "./state/tasks.ts";
import type { ChannelState, Task } from "./state/types.ts";
import { pausingStep, runSight } from "./state/landing-steps.ts";
import { currentStep, spanText, stepMove, stepText, type LandingStep } from "./steps.ts";

type MoveFor = "work" | "start" | "assign" | "review" | "route" | "revise" | "answer" | "land";

type RunTrouble = "run failed" | "run can't be seen" | "run overran";

export type Mover =
  | { kind: "member"; name: string; move: MoveFor; question?: number; step?: string; why?: RunTrouble }
  | { kind: "waiting"; owner: string; ahead: number }
  | { kind: "run"; step: string; behind: string; due: number; left: number }
  | { kind: "hold"; step: string; until: number; left: number; reason: string }
  | { kind: "nobody"; move: MoveFor };

type Board = Pick<ChannelState, "tasks" | "members" | "lead" | "openAsks" | "github">;

const here = (state: Board, name: string | undefined | null): name is string => !!name && state.members.get(name)?.active === true;

export function channelOwner(state: Pick<ChannelState, "members">): string | undefined {
  return [...state.members.values()].find((m) => m.owner && m.active)?.name;
}

function settle(state: Board, name: string | undefined | null, move: MoveFor, question?: number): Mover {
  const who = here(state, name) ? name : channelOwner(state);
  return who ? { kind: "member", name: who, move, ...(question !== undefined ? { question } : {}) } : { kind: "nobody", move };
}

const leadOr = (state: Board, name: string | undefined, move: MoveFor, unowned: MoveFor): Mover => (name ? settle(state, name, move) : settle(state, state.lead, unowned));

function heldBy(state: Board, t: Task): Mover | undefined {
  const oldest = state.openAsks.filter((m) => m.holds?.includes(t.id)).sort((a, b) => a.seq - b.seq)[0];
  if (!oldest) return undefined;
  const named = oldest.to ?? [];
  const person = named.find((n) => {
    const m = state.members.get(n);
    return !!m && isPerson(m);
  });
  return settle(state, person ?? named[0], "answer", oldest.seq);
}

function queued(state: Board, t: Task, owner: string): Mover {
  const theirs = [...state.tasks.values()].filter((x) => x.owner === owner && !x.archived);
  const ahead = theirs.filter((x) => x.state === "doing" || (x.state === "todo" && x.id < t.id)).length;
  return ahead ? { kind: "waiting", owner, ahead } : settle(state, owner, "start");
}

function stepMover(state: Board, t: Task, step: LandingStep, now: number): Mover {
  const move = stepMove(step, landerOf(t), now, step.run ? runSight(state.github, t, step) : "blind");
  if (move.kind === "waiting") return { kind: "hold", step: stepText(step), until: move.until, left: move.until - now, reason: move.reason };
  if (move.kind === "run") return { kind: "run", step: stepText(step), behind: move.behind, due: move.due, left: move.due - now };
  if (move.kind === "nobody") return settle(state, state.lead, "assign");
  const settled = settle(state, move.name, "land");
  return settled.kind === "member" ? { ...settled, step: stepText(step), ...(move.why ? { why: move.why } : {}) } : settled;
}

function landingMover(state: Board, t: Task, now: number): Mover {
  const step = currentStep(t);
  return step ? stepMover(state, t, step, now) : leadOr(state, landerOf(t), "land", "assign");
}

export function moverOf(state: Board, t: Task, now: number = Date.now()): Mover | undefined {
  if (t.state === "done" || t.archived) return undefined;
  const held = heldBy(state, t);
  if (held) return held;
  const paused = pausingStep(state.github, t, now);
  if (paused?.kind === "hold") return { kind: "hold", step: stepText(paused.step), until: paused.until, left: paused.until - now, reason: paused.reason };
  if (paused) return { kind: "run", step: stepText(paused.step), behind: paused.behind, due: paused.due, left: paused.due - now };
  if (t.state === "doing") return leadOr(state, t.owner, "work", "assign");
  if (t.state === "todo") return t.owner && here(state, t.owner) ? queued(state, t, t.owner) : leadOr(state, t.owner, "start", "assign");
  if (t.state === "landing") return landingMover(state, t, now);
  if (!openRound(t)) return leadOr(state, t.owner, "revise", "assign");
  return t.review && t.review !== "*" ? settle(state, t.review, "review") : settle(state, state.lead, "route");
}

const MOVE_WORDS: Record<MoveFor, string> = {
  work: "to work on it",
  start: "to start it",
  assign: "to give it an owner",
  review: "to review it",
  route: "to give it a reviewer",
  revise: "to send it for review again",
  answer: "to answer",
  land: "to land it",
};

const memberWords = (m: Extract<Mover, { kind: "member" }>): string => `${inlineText(m.name, 40)} ${MOVE_WORDS[m.move]}${m.question !== undefined ? ` #${m.question}` : ""}`;

export function moverText(m: Mover): string {
  if (m.kind === "waiting") return `waiting, ${m.ahead} ahead of it for ${inlineText(m.owner, 40)}`;
  if (m.kind === "nobody") return `nobody ${MOVE_WORDS[m.move]}: the channel has no owner here`;
  if (m.kind === "run") return `nobody while step ${inlineText(m.step, 80)} runs; ${inlineText(m.behind, 40)} takes it if the run isn't done in ${spanText(m.left)}`;
  if (m.kind === "hold") return `nobody for ${spanText(m.left)}: step ${inlineText(m.step, 80)} waits (${inlineText(m.reason, 120)})`;
  return `${memberWords(m)}${m.step ? `: step ${inlineText(m.step, 80)}${m.why ? ` (its ${m.why})` : ""}` : ""}`;
}

export function moverTag(t: Pick<Task, "owner">, m: Mover | undefined): string {
  if (!m) return "";
  if (m.kind === "waiting") return ` · waiting, ${m.ahead} ahead`;
  if (m.kind === "nobody") return "";
  if (m.kind === "run") return ` · a run has the move for ${spanText(m.left)}, then ${inlineText(m.behind, 40)}`;
  if (m.kind === "hold") return ` · nobody's move for ${spanText(m.left)}`;
  return m.name === t.owner && m.move !== "revise" && !m.why ? "" : ` · move: ${memberWords(m)}${m.why ? ` (its ${m.why})` : ""}`;
}
