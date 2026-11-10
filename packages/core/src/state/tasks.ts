import { hasLanding, type Landing, type OldTaskState, type TaskState, type Verdict } from "../protocol.ts";
import type { CheckAsk, CheckPhase } from "../checks.ts";
import type { CheckState } from "./checks.ts";
import type { ChannelState, ReviewRound, Task } from "./types.ts";

export function taskId(id: number): string {
  return `T${id}`;
}

export function currentState(s: TaskState | OldTaskState): TaskState {
  return s === "blocked" ? "doing" : s === "cancelled" ? "done" : s;
}

export function parseTaskId(s: string): number | null {
  const m = /^(?:[Tt#])?(\d+)$/.exec(s.trim());
  return m ? Number(m[1]) : null;
}

export function worked(task: Task, name: string): void {
  if (!task.workedBy.includes(name)) task.workedBy.push(name);
}

export function reviewWaysOut(id: number, review: string, round: number): string {
  const t = taskId(id);
  return `${review === "*" ? "someone who hasn't worked on it" : review} answers kiwi task approve ${t} --round ${round}; the lead or a person can move the review (kiwi task review ${t} --review OTHER) or close the task (kiwi task close ${t} "why")`;
}

export function openRound(task: Task): ReviewRound | undefined {
  const last = task.rounds.at(-1);
  return last?.result.kind === "open" ? last : undefined;
}

export function closeCancelled(task: Task, mark: { seq: number; by: string; at: number }, note: string): void {
  const open = openRound(task);
  if (open) open.result = { kind: "withdrawn", seq: mark.seq };
  task.state = "done";
  task.cancelled = true;
  task.closedSeq = mark.seq;
  task.approvedBy = undefined;
  task.updatedAt = mark.at;
  task.notes.push({ seq: mark.seq, by: mark.by, ts: mark.at, text: note });
}

export function verdictRefusal(task: Task, verdict: Verdict, ev: { state?: string; round?: number; at?: string; body?: "review" }, mayFinish: boolean, open: ReviewRound | undefined): string | null {
  const id = taskId(task.id);
  if ((verdict === "approved" && ev.state !== "done") || (verdict === "rejected" && ev.state !== "doing")) return "an approval finishes the task and a rejection sends it back to doing";
  if (task.state === "landing") return `${id} is already approved: it lands next`;
  if (ev.round === undefined) return (verdict === "approved" || ev.body) && task.rounds.length ? `a verdict on ${id} names the round it judges` : null;
  if (task.state === "done") return `${id} is already done`;
  if (!mayFinish) return `only ${task.review === "*" ? "someone who hasn't worked on it" : task.review} gives ${id}'s verdict`;
  if (!open) return `${id} has no review round open`;
  if (open.n !== ev.round) return `round ${ev.round} of ${id} isn't the open one: round ${open.n} is`;
  if (ev.at !== undefined && ev.at.trim() !== open.at) return `round ${open.n} of ${id} is ${open.at ? `at ${open.at}` : "at no commit"}, not at ${ev.at.trim()}`;
  return null;
}

const PR_URL_RE = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+(?:[/?#]\S*)?$/;

const isPrUrl = (url: string): boolean => PR_URL_RE.test(url);

type LandingChange = { state?: string; verdict?: Verdict; close?: string; then?: Landing; lander?: string | null; owner?: string | null; proof?: { url: string }; run?: { id: string } };

export const landerOf = (task: Pick<Task, "lander" | "owner">): string | undefined => task.lander ?? task.owner;

const newPr = (task: Task, proof: { url: string } | undefined): boolean => !!proof && isPrUrl(proof.url) && !task.proof?.some((p) => p.url === proof.url);

export const newRun = (task: Task, run: { id: string } | undefined): boolean => !!run && !!task.run && task.run.id !== run.id;

export function runRefusal(task: Task, run: { id: string; started?: number } | undefined, received: number | undefined): string | null {
  if (run?.started === undefined) return null;
  if (received === undefined || run.started > received) return `run ${run.id} can't have started after its proof arrived`;
  const known = task.run?.id === run.id ? task.run.reportedStart : undefined;
  return known !== undefined && known !== run.started ? `run ${run.id}'s start is already recorded` : null;
}

function landerAfter(task: Task, ev: LandingChange): string | undefined {
  const lander = ev.lander === undefined ? task.lander : ev.lander || undefined;
  const owner = ev.owner === undefined ? task.owner : ev.owner || undefined;
  return lander ?? owner;
}

export function landingRefusal(task: Task, ev: LandingChange, from: { person: boolean; lead: boolean }): string | null {
  const id = taskId(task.id);
  const trusted = from.person || from.lead;
  if (ev.close !== undefined) return trusted ? (task.state === "done" ? `${id} is already done` : null) : `only a person or the lead closes ${id} with a reason`;
  if ((ev.then !== undefined || ev.lander !== undefined) && !trusted) return `only a person or the lead changes how ${id} lands`;
  if (task.state === "landing" && landerAfter(task, ev) !== landerOf(task) && !trusted) return `only a person or the lead changes who lands ${id}`;
  if (ev.state === "landing" && !hasLanding(task.then)) return `${id} has no landing step: it finishes on approval`;
  if (ev.state === "done" && ev.verdict !== "approved" && hasLanding(task.then) && task.state !== "done") return `${id} lands by its step (${task.then}): approve it, or close it with a reason`;
  if (task.state === "landing" && newPr(task, ev.proof) && !trusted) return `only a person or the lead links another PR to ${id} once it's approved`;
  if (task.state === "landing" && newRun(task, ev.run) && !trusted) return `only a person or the lead declares another run for ${id} once it's approved`;
  return null;
}

export function landingReopens(task: Task, ev: LandingChange): boolean {
  if (task.state !== "landing") return false;
  return (ev.then !== undefined && ev.then !== (task.then ?? "none")) || landerAfter(task, ev) !== landerOf(task) || newPr(task, ev.proof) || newRun(task, ev.run);
}

const landingHeld = (tasks: ReadonlyMap<number, Task>, phase: CheckPhase, holds: readonly number[]): Task[] =>
  phase !== "pre-ship"
    ? []
    : holds.flatMap((id) => {
        const t = tasks.get(id);
        return t?.state === "landing" ? [t] : [];
      });

const liveCheck = (checks: ReadonlyMap<number, CheckState>, id: number): CheckState | undefined => {
  const c = checks.get(id);
  return c && c.closed === undefined && c.supersededBy === undefined ? c : undefined;
};

export function landingTouchedByAsk(
  tasks: ReadonlyMap<number, Task>,
  checks: ReadonlyMap<number, CheckState>,
  m: { check?: CheckAsk; choices?: readonly string[]; holds?: readonly number[] },
): Task[] {
  if (!m.check || !m.choices?.length) return [];
  const was = m.check.replaces === undefined ? undefined : liveCheck(checks, m.check.replaces);
  return [...new Set([...landingHeld(tasks, m.check.phase, m.holds ?? []), ...(was ? landingHeld(tasks, was.phase, was.holds) : [])])];
}

export const landingTouchedByClose = (tasks: ReadonlyMap<number, Task>, checks: ReadonlyMap<number, CheckState>, ask: number): Task[] => {
  const c = liveCheck(checks, ask);
  return c ? landingHeld(tasks, c.phase, c.holds) : [];
};

export function checkChangeRefusal(touched: readonly Task[], from: { person: boolean; lead: boolean }, change: "adds a check to" | "replaces a check on" | "closes a check on"): string | null {
  if (!touched.length || from.person || from.lead) return null;
  return `only a person or the lead ${change} ${touched.map((t) => taskId(t.id)).join(", ")} once it's approved`;
}

export function backToReview(task: Task, mark: { seq: number; by: string; ts: number; rts?: number }, why: string): void {
  const last = task.rounds.at(-1);
  task.rounds.push({
    n: (last?.n ?? 0) + 1,
    ...(last?.at ? { at: last.at } : {}),
    by: mark.by,
    seq: mark.seq,
    ts: mark.ts,
    ...(mark.rts !== undefined ? { rts: mark.rts } : {}),
    result: { kind: "open" },
  });
  task.state = "review";
  task.approvedBy = undefined;
  task.updatedAt = mark.ts;
  task.notes.push({ seq: mark.seq, by: mark.by, ts: mark.ts, text: `${why}: back to review` });
}

export function reviewMoveRefusal(task: Task, from: { name: string; person: boolean; lead: boolean }, review: string | null | undefined): string | null {
  if (review === undefined || !task.review) return null;
  if (from.person || from.lead || from.name === task.review) return null;
  return `only a person, the lead or ${task.review === "*" ? "a reviewer" : task.review} changes who reviews ${taskId(task.id)}`;
}

export function reviewClaimRefusal(task: Task, from: string, review: string | null | undefined): string | null {
  const id = taskId(task.id);
  if (review !== from) return `a claim takes ${id}'s review for the one claiming it`;
  if (task.review !== "*") return task.review ? `${id}'s review isn't open to anyone: ${task.review} reviews it` : `${id} has no review to take`;
  if (from === task.owner || task.workedBy.includes(from)) return `${from} has worked on ${id}, so someone else reviews it`;
  return null;
}

export function revisedOut(task: Task, from: string, open: ReviewRound | undefined): number | null {
  const last = task.rounds.at(-1);
  return !open && last?.result.kind === "rejected" && (from === task.owner || from === task.createdBy) ? last.n : null;
}

const OPEN_FOR_TITLE = new Set<TaskState>(["todo", "doing", "review", "landing"]);

function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/(?<![a-z0-9])v(\d)/g, "$1")
    .replace(/([a-z])-(\d)/g, "$1$2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const hasDigit = (w: string) => /\d/.test(w);

function titleWords(norm: string): string[] {
  return [...new Set(norm.split(" ").filter((w) => w.length > 2 || hasDigit(w)))];
}

const TITLE_ID = /(?<![a-z0-9])(?:([a-z]+)-?)?(\d+(?:[.-]\d+)*[a-z]*)(?![a-z0-9])/g;

function titleIds(title: string): Set<string> {
  return new Set([...title.toLowerCase().matchAll(TITLE_ID)].map(([, prefix, digits]) => `${prefix && prefix !== "v" ? prefix : ""}${digits}`));
}

function idsDiffer(a: string, b: string): boolean {
  const ia = titleIds(a);
  const ib = titleIds(b);
  return ia.size > 0 && ib.size > 0 && (ia.size !== ib.size || [...ia].some((id) => !ib.has(id)));
}

export function titlesLookAlike(a: string, b: string): boolean {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (idsDiffer(a, b)) return false;
  const wa = titleWords(na);
  const wb = titleWords(nb);
  const shorter = na.length <= nb.length ? na : nb;
  const longer = shorter === na ? nb : na;
  if (shorter.length >= 8 && longer.includes(shorter)) return true;
  if (!wa.length || !wb.length) return false;
  const shared = wa.filter((w) => wb.includes(w)).length;
  return shared >= 2 && shared / Math.min(wa.length, wb.length) >= 0.6;
}

export function similarOpenTasks(state: ChannelState, title: string): Task[] {
  return [...state.tasks.values()].filter((t) => OPEN_FOR_TITLE.has(t.state) && titlesLookAlike(title, t.title)).sort((a, b) => a.id - b.id);
}
