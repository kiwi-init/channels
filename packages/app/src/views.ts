import { askGroups, releaseOf, type AskGroup, type AskHead, type ChannelState, type GithubRelease, type Task } from "@kiwi/core/state.ts";
import { statusOf, type TaskStatus } from "@kiwi/core/status.ts";
import { DONE_RECENTLY, STATE_LABEL } from "./task-labels";

export type Tab = "tasks" | "agents" | "conversation";

export const TABS: [Tab, string][] = [
  ["tasks", "Tasks"],
  ["agents", "Agents"],
  ["conversation", "Conversation"],
];

export type View = "everything" | "needs" | "doing" | "review" | "done";

export const VIEWS: [View, string][] = [
  ["everything", "Everything"],
  ["needs", "Needs you"],
  ["doing", STATE_LABEL.doing],
  ["review", STATE_LABEL.review],
  ["done", DONE_RECENTLY],
];

const WEEK = 7 * 24 * 60 * 60 * 1000;

export const NEXT_RELEASE_NOTE = "release.next";

interface Fate {
  task: Task;
  finished: boolean;
  status: TaskStatus["status"];
  release?: GithubRelease;
  at: number;
}

function fateOf(state: ChannelState, t: Task): Fate {
  const { status, stage } = statusOf(state, t);
  const merged = stage.pr?.state === "merged" ? stage.pr : undefined;
  const release = status === "shipped" && merged ? releaseOf(state.github, merged) : undefined;
  return { task: t, finished: status === "done" || status === "shipped" || status === "cancelled", status, ...(release ? { release } : {}), at: Math.max(t.updatedAt, merged?.at ?? 0) };
}

function shows(f: Fate, view: View, now: number, waiting: ReadonlySet<number>): boolean {
  const t = f.task;
  if (t.archived) return false;
  switch (view) {
    case "everything":
      return !f.finished || now - f.at < WEEK;
    case "needs":
      return !f.finished && waiting.has(t.id);
    case "doing":
      return !f.finished && t.state === "doing";
    case "review":
      return !f.finished && t.state === "review";
    case "done":
      return f.finished && now - f.at < WEEK;
  }
}

export function inView(state: ChannelState, t: Task, view: View, now: number, waiting: ReadonlySet<number>): boolean {
  return shows(fateOf(state, t), view, now, waiting);
}

export type GroupHead = { kind: "ask"; ask: AskHead | null } | { kind: "next"; name: string | null } | { kind: "release"; tag: string; at: number } | { kind: "cancelled" };

export interface TaskGroup {
  key: string;
  head: GroupHead;
  tasks: Task[];
}

const ORDER: Record<Task["state"], number> = { doing: 0, review: 1, todo: 2, done: 3 };
const NOBODY: ReadonlySet<number> = new Set();

function nextRelease(state: Pick<ChannelState, "facts">, now: number): string | null {
  const note = state.facts.get(NEXT_RELEASE_NOTE);
  return note && (!note.expires || note.expires > now) ? note.value.trim() || null : null;
}

export function taskGroups(state: ChannelState, view: View, now: number): TaskGroup[] {
  if (view === "needs") return [];
  const shown = [...state.tasks.values()]
    .map((t) => fateOf(state, t))
    .filter((f) => shows(f, view, now, NOBODY))
    .sort((a, b) => ORDER[a.task.state] - ORDER[b.task.state] || b.task.updatedAt - a.task.updatedAt);
  const byRelease = state.github.releases.size > 0;
  const asked = (byRelease ? shown.filter((f) => !f.finished) : shown).map((f) => f.task);
  const latest = (g: AskGroup) => Math.max(...g.tasks.map((t) => t.updatedAt));
  const groups: TaskGroup[] = askGroups(state, asked)
    .sort((a, b) => (a.head === null ? 1 : b.head === null ? -1 : latest(b) - latest(a)))
    .map((g) => ({ key: g.head ? `ask:${g.head.id}` : "unfiled", head: { kind: "ask", ask: g.head }, tasks: g.tasks }));
  if (!byRelease) return groups;
  const finished = shown.filter((f) => f.finished).sort((a, b) => b.at - a.at);
  const next = finished.filter((f) => f.status === "done").map((f) => f.task);
  if (next.length) groups.push({ key: "next", head: { kind: "next", name: nextRelease(state, now) }, tasks: next });
  const releases = new Map<string, { at: number; tasks: Task[] }>();
  for (const f of finished) {
    if (!f.release) continue;
    const held = releases.get(f.release.tag) ?? { at: f.release.at, tasks: [] };
    held.tasks.push(f.task);
    releases.set(f.release.tag, held);
  }
  for (const [tag, r] of [...releases].sort((a, b) => b[1].at - a[1].at)) groups.push({ key: `release:${tag}`, head: { kind: "release", tag, at: r.at }, tasks: r.tasks });
  const cancelled = finished.filter((f) => f.status === "cancelled").map((f) => f.task);
  if (cancelled.length) groups.push({ key: "cancelled", head: { kind: "cancelled" }, tasks: cancelled });
  return groups;
}

export function viewCounts(state: ChannelState, now: number, needs: number, waiting: ReadonlySet<number>): Record<View, number> {
  const fates = [...state.tasks.values()].map((t) => fateOf(state, t));
  const count = (v: View) => fates.filter((f) => shows(f, v, now, waiting)).length;
  return { everything: count("everything"), needs, doing: count("doing"), review: count("review"), done: count("done") };
}

export function mergedSince(state: Pick<ChannelState, "github">, since: number): number {
  return [...state.github.prs.values()].filter((p) => p.state === "merged" && p.at >= since).length;
}

export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
