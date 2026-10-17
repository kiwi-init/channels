import type { OldTaskState, TaskState, Verdict } from "../protocol.ts";
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

export function openRound(task: Task): ReviewRound | undefined {
  const last = task.rounds.at(-1);
  return last?.result.kind === "open" ? last : undefined;
}

export function verdictRefusal(task: Task, verdict: Verdict, ev: { state?: string; round?: number; at?: string; body?: "review" }, mayFinish: boolean, open: ReviewRound | undefined): string | null {
  const id = taskId(task.id);
  if (ev.round === undefined) return (verdict === "approved" || ev.body) && task.rounds.length ? `a verdict on ${id} names the round it judges` : null;
  if ((verdict === "approved" && ev.state !== "done") || (verdict === "rejected" && ev.state !== "doing")) return "an approval finishes the task and a rejection sends it back to doing";
  if (task.state === "done") return `${id} is already done`;
  if (!mayFinish) return `only ${task.review === "*" ? "someone who hasn't worked on it" : task.review} gives ${id}'s verdict`;
  if (!open) return `${id} has no review round open`;
  if (open.n !== ev.round) return `round ${ev.round} of ${id} isn't the open one: round ${open.n} is`;
  if (ev.at !== undefined && ev.at.trim() !== open.at) return `round ${open.n} of ${id} is ${open.at ? `at ${open.at}` : "at no commit"}, not at ${ev.at.trim()}`;
  return null;
}

export function revisedOut(task: Task, from: string, open: ReviewRound | undefined): number | null {
  const last = task.rounds.at(-1);
  return !open && last?.result.kind === "rejected" && (from === task.owner || from === task.createdBy) ? last.n : null;
}

const OPEN_FOR_TITLE = new Set<TaskState>(["todo", "doing", "review"]);

function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function titlesLookAlike(a: string, b: string): boolean {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = shorter === na ? nb : na;
  if (shorter.length >= 8 && longer.includes(shorter)) return true;
  const wa = [...new Set(na.split(" ").filter((w) => w.length > 2))];
  const wb = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (!wa.length || !wb.size) return false;
  const shared = wa.filter((w) => wb.has(w)).length;
  return shared / Math.min(wa.length, wb.size) >= 0.6;
}

export function similarOpenTasks(state: ChannelState, title: string): Task[] {
  return [...state.tasks.values()].filter((t) => OPEN_FOR_TITLE.has(t.state) && titlesLookAlike(title, t.title)).sort((a, b) => a.id - b.id);
}
