import type { NudgeStep } from "../protocol.ts";
import { prOfTask } from "../prs.ts";
import { currentStep, stepMove } from "../steps.ts";
import { runSight } from "./landing-steps.ts";
import { landerOf, openRound, taskId } from "./tasks.ts";
import type { ChannelState, Task, TaskClock } from "./types.ts";

export const QUIET_MS = 20 * 60_000;
export const QUEUE_MS = 24 * 60 * 60_000;

export type ClockView = Pick<ChannelState, "tasks" | "openAsks" | "github" | "branchPrefix">;

const WAITING = "~waiting|";
const LEAD = "@lead";
const NONE = { key: "~none", mover: "" };

export const queuedKey = (key: string): boolean => key.startsWith(WAITING);
export const memberKey = (key: string): boolean => !key.startsWith("~") && !key.startsWith("?");
export const partyOfKey = (key: string): string => (queuedKey(key) ? key.slice(WAITING.length) : key.startsWith("~") ? "" : (key.split("|")[0] ?? ""));

type Party = { key: string; mover: string };

const lead = (move: string): Party => ({ key: `${LEAD}|${move}`, mover: LEAD });
const member = (name: string, move: string, more = ""): Party => ({ key: `${name}|${move}|${more}`, mover: name });

function landingParty(view: ClockView, t: Task, now: number): Party {
  const step = currentStep(t);
  const lander = landerOf(t);
  if (!step) return lander ? member(lander, "land") : lead("assign");
  const move = stepMove(step, lander, now, step.run ? runSight(view.github, t, step) : "blind");
  if (move.kind === "waiting" || move.kind === "run") return NONE;
  return move.kind === "member" ? member(move.name, "land", `${step.id}|${move.why ?? ""}`) : lead("assign");
}

function queueParty(view: ClockView, t: Task, owner: string): Party {
  for (const x of view.tasks.values()) if (x.owner === owner && !x.archived && (x.state === "doing" || (x.state === "todo" && x.id < t.id))) return { key: `${WAITING}${owner}`, mover: owner };
  return member(owner, "start");
}

function partyOf(view: ClockView, t: Task, now: number): Party {
  const question = view.openAsks.filter((m) => m.holds?.includes(t.id)).sort((a, b) => a.seq - b.seq)[0];
  if (question) return { key: `?${question.seq}`, mover: `?${question.seq}` };
  if (t.state === "doing") return t.owner ? member(t.owner, "work") : lead("assign");
  if (t.state === "todo") return t.owner ? queueParty(view, t, t.owner) : lead("assign");
  if (t.state === "landing") return landingParty(view, t, now);
  const round = openRound(t);
  if (!round) return t.owner ? member(t.owner, "revise") : lead("assign");
  return t.review && t.review !== "*" ? member(t.review, "review", String(round.n)) : lead("route");
}

function passedDeadline(t: Task, now: number): number | undefined {
  const step = t.state === "landing" ? currentStep(t) : undefined;
  const passed = [step?.wait?.until, step?.run?.due].filter((x): x is number => x !== undefined && x <= now);
  return passed.length ? Math.max(...passed) : undefined;
}

export const timedStep = (t: Task): boolean => {
  const step = t.state === "landing" ? currentStep(t) : undefined;
  return !!step && (step.wait !== undefined || step.run !== undefined);
};

const headOf = (view: ClockView, t: Task): string | undefined => prOfTask(view.github, view.branchPrefix, t)?.sha;

export function rolled(view: ClockView, t: Task, now: number): TaskClock | undefined {
  if (t.state === "done" || t.archived) return undefined;
  const cur = partyOf(view, t, now);
  const was = t.clock;
  if (was?.key === cur.key) return was;
  return { key: cur.key, seq: was?.seq ?? t.id, at: passedDeadline(t, now) ?? was?.at ?? t.createdAt, ...(was?.head ? { head: was.head } : {}) };
}

export function roll(view: ClockView, t: Task, now: number): void {
  t.clock = rolled(view, t, now);
}

export function tick(view: ClockView, t: Task, mark: { seq: number; at: number; by?: string }): void {
  if (t.state === "done" || t.archived) {
    t.clock = undefined;
    return;
  }
  const cur = partyOf(view, t, mark.at);
  const head = headOf(view, t);
  const was = t.clock;
  const theirs = memberKey(cur.key) && cur.mover !== LEAD;
  const pushed = theirs && was !== undefined && head !== undefined && head !== was.head && cur.mover === t.owner;
  const progressed = theirs && mark.by !== undefined && mark.by === cur.mover;
  if (was?.key === cur.key && !pushed && !progressed) {
    if (head !== was.head) t.clock = { ...was, ...(head ? { head } : {}) };
    return;
  }
  t.clock = { key: cur.key, seq: mark.seq, at: mark.at, ...(head ? { head } : {}) };
}

type Nudge = { mover: string; since: number; step: NudgeStep; day?: number };

export function nudge(view: ClockView, t: Task, ev: Nudge, at: number): string | null {
  const id = taskId(t.id);
  roll(view, t, at);
  const clock = t.clock;
  if (!clock) return `${id} is already done`;
  if (ev.step > 0 && clock.key.startsWith("?")) return `${id} waits on an answer to #${clock.key.slice(1)}: that is in Needs you, not on the clock`;
  const party = partyOfKey(clock.key);
  if (party !== ev.mover || clock.seq !== ev.since) return `${id}'s clock moved on: it is ${party || "nobody"}'s since #${clock.seq}`;
  if (ev.step === 0) {
    const day = ev.day ?? 0;
    if (!queuedKey(clock.key)) return `${id} isn't waiting in a queue`;
    if (day < 1 || at - clock.at < day * QUEUE_MS) return `${id} hasn't waited that long in its queue`;
    if (day > (clock.day ?? 0)) t.clock = { ...clock, day };
    return null;
  }
  if (!memberKey(clock.key)) return `${id} has no member on the clock`;
  if (at - clock.at < ev.step * QUIET_MS) return `${id} hasn't been quiet long enough for step ${ev.step} of its clock`;
  if (ev.step > (clock.step ?? 0)) t.clock = { ...clock, step: ev.step };
  return null;
}
