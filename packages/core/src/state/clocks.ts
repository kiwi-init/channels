import { QUIET_MINUTES, type NudgeStep, type WakeGot, type WakeSeen } from "../protocol.ts";
import { prOfTask } from "../prs.ts";
import { currentStep, stepMove } from "../steps.ts";
import { heldStep, pausingStep, runSight } from "./landing-steps.ts";
import { landerOf, openRound, taskId } from "./tasks.ts";
import type { ChannelState, Task, TaskClock, Woke } from "./types.ts";

export const QUIET_MS = QUIET_MINUTES * 60_000;
export const QUEUE_MS = 24 * 60 * 60_000;
export const UNREAD_MS = 5 * 60_000;

export type ClockView = Pick<ChannelState, "tasks" | "openAsks" | "github" | "branchPrefix" | "quietMs">;

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
  if (pausingStep(view.github, t, now)) return NONE;
  if (t.state === "doing") return t.owner ? member(t.owner, "work") : lead("assign");
  if (t.state === "todo") return t.owner ? queueParty(view, t, t.owner) : lead("assign");
  if (t.state === "landing") return landingParty(view, t, now);
  const round = openRound(t);
  if (!round) return t.owner ? member(t.owner, "revise") : lead("assign");
  return t.review && t.review !== "*" ? member(t.review, "review", String(round.n)) : lead("route");
}

function deadlines(t: Task): (number | undefined)[] {
  if (t.state === "landing") {
    const step = currentStep(t);
    return [step?.wait?.until, step?.run?.due];
  }
  const held = heldStep(t)?.hold;
  return [held?.until, held?.due];
}

function passedDeadline(t: Task, now: number): number | undefined {
  const passed = deadlines(t).filter((x): x is number => x !== undefined && x <= now);
  return passed.length ? Math.max(...passed) : undefined;
}

export const timedStep = (t: Task): boolean => {
  if (t.state !== "landing") return heldStep(t) !== undefined;
  const step = currentStep(t);
  return !!step && (step.wait !== undefined || step.run !== undefined);
};

const headOf = (view: ClockView, t: Task): string | undefined => prOfTask(view.github, view.branchPrefix, t)?.sha;

export function rolled(view: ClockView, t: Task, now: number): TaskClock | undefined {
  if (t.state === "done" || t.archived) return undefined;
  const cur = partyOf(view, t, now);
  const was = t.clock;
  if (was?.key === cur.key) return was;
  const deadline = passedDeadline(t, now);
  const floor = t.state === "landing" ? undefined : was?.at;
  const at = deadline !== undefined && floor !== undefined ? Math.max(deadline, floor) : (deadline ?? was?.at ?? t.createdAt);
  return { key: cur.key, seq: was?.seq ?? t.id, at, ...(was?.head ? { head: was.head } : {}) };
}

export function roll(view: ClockView, t: Task, now: number): void {
  t.clock = rolled(view, t, now);
}

type Act = NonNullable<TaskClock["acts"]>[number];

const acted = (clock: TaskClock, by: string, seq: number, at: number): Act[] => [...(clock.acts ?? []).filter((a) => a[0] !== by), [by, seq, at]];

export function actOf(clock: TaskClock, name: string): { seq: number; at: number; step: 0 | 1 | 2 | 3 } | undefined {
  const act = clock.acts?.find((a) => a[0] === name);
  return act && act[1] > clock.seq ? { seq: act[1], at: act[2], step: act[3] ?? 0 } : undefined;
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
    const acts = cur.mover === LEAD && mark.by !== undefined ? acted(was, mark.by, mark.seq, mark.at) : was.acts;
    if (head !== was.head || acts !== was.acts) t.clock = { ...was, ...(head ? { head } : {}), ...(acts ? { acts } : {}) };
    return;
  }
  t.clock = { key: cur.key, seq: mark.seq, at: mark.at, ...(head ? { head } : {}) };
}

type Nudge = { mover: string; since: number; step: NudgeStep; day?: number; wake?: WakeSeen };
type Rung = Nudge & { step: 1 | 2 | 3 };

export const wokeFor = (clock: TaskClock, since: number): Woke | undefined => (clock.woke?.since === since ? clock.woke : undefined);

export const wakeSeen = (woke: Woke | undefined): WakeSeen => (!woke ? "none" : woke.read !== undefined ? "read" : woke.delivered !== undefined ? "delivered" : "attempted");

function reached(clock: TaskClock, ev: Rung, quietFrom: number, at: number, every: number): boolean {
  if (at - quietFrom >= ev.step * every) return true;
  if (ev.step !== 2 || at - quietFrom < every) return false;
  const woke = wokeFor(clock, ev.since);
  return woke ? woke.read === undefined && at - woke.at >= UNREAD_MS : ev.wake === "none";
}

function stepOnAct(clock: TaskClock, ev: Rung, mark: Mark, every: number, lead: string | undefined): TaskClock | string | undefined {
  const act = clock.acts?.find((a) => a[1] === ev.since && a[1] > clock.seq);
  if (!act || act[0] !== lead) return undefined;
  if (!reached(clock, ev, act[2], mark.at, every)) return "early";
  const stepped = ev.step <= (act[3] ?? 0) ? clock : { ...clock, acts: (clock.acts ?? []).map((a): Act => (a === act ? [a[0], a[1], a[2], ev.step] : a)) };
  return attempted(stepped, ev, mark);
}

const attempted = (clock: TaskClock, ev: Rung, mark: Mark): TaskClock =>
  ev.step !== 1 || wokeFor(clock, ev.since) ? clock : { ...clock, woke: { since: ev.since, seq: mark.seq, by: mark.by, at: mark.at } };

export interface NudgeWho {
  agentQueue: (owner: string) => boolean;
  lead: () => string | undefined;
  stands: (name: string) => string | undefined;
}

interface Mark {
  seq: number;
  at: number;
  by: string;
}

const seatOf = (party: string, who: NudgeWho): string | undefined => (party === LEAD ? who.lead() : who.stands(party));

export function nudge(view: ClockView, t: Task, ev: Nudge, mark: Mark, who: NudgeWho): string | null {
  const id = taskId(t.id);
  const at = mark.at;
  roll(view, t, at);
  const held = t.clock;
  if (!held) return `${id} is already done`;
  if (ev.step > 0 && held.key.startsWith("?")) return `${id} waits on an answer to #${held.key.slice(1)}: that is in Needs you, not on the clock`;
  const party = partyOfKey(held.key);
  const early = `${id} hasn't been quiet long enough for step ${ev.step} of its clock`;
  const rung: Rung | undefined = ev.step === 0 ? undefined : { ...ev, step: ev.step };
  const unfit = (): string | null => {
    if (rung?.step === 1 && mark.by !== seatOf(party, who)) return `only the daemon hosting ${id}'s mover records its wake, as that seat`;
    const stands = wakeSeen(wokeFor(held, ev.since));
    return rung?.wake !== undefined && rung.wake !== stands ? `${id}'s wake stands as ${stands}, not ${rung.wake}` : null;
  };
  if (rung && party === ev.mover && held.seq !== ev.since) {
    const onAct = stepOnAct(held, rung, mark, view.quietMs, party === LEAD ? who.lead() : undefined);
    if (onAct !== undefined && unfit()) return unfit();
    if (onAct === "early") return early;
    if (typeof onAct === "object") {
      t.clock = onAct;
      return null;
    }
  }
  const clock = party === ev.mover && held.seq === ev.since ? held : undefined;
  if (!clock) return `${id}'s clock moved on: it is ${party || "nobody"}'s since #${held.seq}`;
  if (rung && memberKey(clock.key) && unfit()) return unfit();
  if (!rung) {
    const day = ev.day ?? 0;
    if (!queuedKey(clock.key)) return `${id} isn't waiting in a queue`;
    if (!who.agentQueue(party)) return `${id} isn't in an agent's queue: ${party} is a person, or has left`;
    if (day < 1 || at - clock.at < day * QUEUE_MS) return `${id} hasn't waited that long in its queue`;
    if (day > (clock.day ?? 0)) t.clock = { ...clock, day };
    return null;
  }
  if (!memberKey(clock.key)) return `${id} has no member on the clock`;
  if (!reached(clock, rung, clock.at, at, view.quietMs)) return early;
  t.clock = attempted(rung.step > (clock.step ?? 0) ? { ...clock, step: rung.step } : clock, rung, mark);
  return null;
}

export function wakeGot(view: ClockView, t: Task, ev: { mover: string; since: number; got: WakeGot }, mark: Mark): string | null {
  const id = taskId(t.id);
  roll(view, t, mark.at);
  const clock = t.clock;
  const woke = clock && partyOfKey(clock.key) === ev.mover ? wokeFor(clock, ev.since) : undefined;
  if (!clock || !woke) return `${id} has no wake attempt for that clock`;
  if (mark.by !== woke.by) return `only ${woke.by}, the seat that was woken, says what came of ${id}'s wake`;
  if (woke[ev.got] === undefined) t.clock = { ...clock, woke: { ...woke, [ev.got]: mark.at } };
  return null;
}
