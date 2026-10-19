import type { ChannelState, Task } from "@kiwi/core/state.ts"
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

type GroupKey = "doing" | "review" | "next" | "done"

export interface TaskGroup {
  key: GroupKey
  label: string
  tasks: Task[]
}

export function taskGroups(state: Pick<ChannelState, "tasks">, view: View, now: number): TaskGroup[] {
  const live = [...state.tasks.values()].filter((t) => !t.archived).sort((a, b) => b.updatedAt - a.updatedAt)
  const of = (key: GroupKey, label: string, keep: (t: Task) => boolean): TaskGroup => ({ key, label, tasks: live.filter(keep) })
  switch (view) {
    case "everything":
      return [
        of("doing", STATE_LABEL.doing, (t) => t.state === "doing"),
        of("review", STATE_LABEL.review, (t) => t.state === "review"),
        of("next", STATE_LABEL.todo, (t) => t.state === "todo"),
        of("done", DONE_RECENTLY, (t) => t.state === "done" && now - t.updatedAt < WEEK),
      ]
    case "needs":
      return []
    case "doing":
      return [of("doing", STATE_LABEL.doing, (t) => t.state === "doing")]
    case "review":
      return [of("review", STATE_LABEL.review, (t) => t.state === "review")]
    case "done":
      return [of("done", DONE_RECENTLY, (t) => t.state === "done" && now - t.updatedAt < WEEK)]
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
