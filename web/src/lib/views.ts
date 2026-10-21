import { askGroups, type AskGroup, type AskHead, type ChannelState, type Task } from "@kiwi/core/state.ts"
import { DONE_RECENTLY, STATE_LABEL } from "./task-labels"

export type Tab = "tasks" | "agents" | "conversation"

export const TABS: [Tab, string][] = [
  ["tasks", "Tasks"],
  ["agents", "Agents"],
  ["conversation", "Conversation"],
]

export type View = "everything" | "needs" | "doing" | "review" | "done"

export const VIEWS: [View, string][] = [
  ["everything", "Everything"],
  ["needs", "Needs you"],
  ["doing", STATE_LABEL.doing],
  ["review", STATE_LABEL.review],
  ["done", DONE_RECENTLY],
]

const WEEK = 7 * 24 * 60 * 60 * 1000

export function inView(t: Task, view: View, now: number, waiting: ReadonlySet<number>): boolean {
  if (t.archived) return false
  const recent = t.state !== "done" || now - t.updatedAt < WEEK
  switch (view) {
    case "everything":
      return recent
    case "needs":
      return t.state !== "done" && waiting.has(t.id)
    case "doing":
      return t.state === "doing"
    case "review":
      return t.state === "review"
    case "done":
      return t.state === "done" && now - t.updatedAt < WEEK
  }
}

export interface TaskGroup {
  key: string
  ask: AskHead | null
  tasks: Task[]
}

const ORDER: Record<Task["state"], number> = { doing: 0, review: 1, todo: 2, done: 3 }
const NOBODY: ReadonlySet<number> = new Set()

export function taskGroups(state: Pick<ChannelState, "tasks" | "askHeads">, view: View, now: number): TaskGroup[] {
  if (view === "needs") return []
  const shown = [...state.tasks.values()].filter((t) => inView(t, view, now, NOBODY)).sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.updatedAt - a.updatedAt)
  const latest = (g: AskGroup) => Math.max(...g.tasks.map((t) => t.updatedAt))
  return askGroups(state, shown)
    .sort((a, b) => (a.head === null ? 1 : b.head === null ? -1 : latest(b) - latest(a)))
    .map((g) => ({ key: g.head ? `ask:${g.head.id}` : "unfiled", ask: g.head, tasks: g.tasks }))
}

export function viewCounts(state: Pick<ChannelState, "tasks">, now: number, needs: number, waiting: ReadonlySet<number>): Record<View, number> {
  const tasks = [...state.tasks.values()]
  const count = (v: View) => tasks.filter((t) => inView(t, v, now, waiting)).length
  return { everything: count("everything"), needs, doing: count("doing"), review: count("review"), done: count("done") }
}

export function mergedSince(state: Pick<ChannelState, "github">, since: number): number {
  return [...state.github.prs.values()].filter((p) => p.state === "merged" && p.at >= since).length
}

export function startOfDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
