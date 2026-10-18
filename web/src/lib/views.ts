import type { ChannelState, Task } from "@kiwi/core/state.ts"

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
  ["doing", "In progress"],
  ["review", "In review"],
  ["done", "Done this week"],
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

type GroupKey = "doing" | "review" | "next" | "done"

export interface TaskGroup {
  key: GroupKey
  label: string
  tasks: Task[]
}

export function taskGroups(state: Pick<ChannelState, "tasks">, view: View, now: number): TaskGroup[] {
  const live = [...state.tasks.values()].filter((t) => !t.archived).sort((a, b) => b.updatedAt - a.updatedAt)
  const today = startOfDay(now)
  const of = (key: GroupKey, label: string, keep: (t: Task) => boolean): TaskGroup => ({ key, label, tasks: live.filter(keep) })
  switch (view) {
    case "everything":
      return [
        of("doing", "In progress", (t) => t.state === "doing" || t.state === "review"),
        of("next", "Up next", (t) => t.state === "todo"),
        of("done", "Done today", (t) => t.state === "done" && t.updatedAt >= today),
      ]
    case "needs":
      return []
    case "doing":
      return [of("doing", "In progress", (t) => t.state === "doing")]
    case "review":
      return [of("review", "In review", (t) => t.state === "review")]
    case "done":
      return [of("done", "Done this week", (t) => t.state === "done" && now - t.updatedAt < WEEK)]
  }
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
