import type { TaskState } from "@kiwi/core/protocol.ts"
import type { Task } from "@kiwi/core/state.ts"

export const STATE_LABEL: Record<TaskState, string> = { todo: "Up next", doing: "In progress", review: "In review", done: "Done" }

export const DONE_RECENTLY = "Done this week"

export const DECISION = "Needs a decision"

export const YOUR_REVIEW = "Ready for your review"

export const labelOf = (t: Pick<Task, "state" | "cancelled">): string => (t.state === "done" && t.cancelled ? "Done (cancelled)" : STATE_LABEL[t.state])

export const stateWord = (t: Pick<Task, "state" | "cancelled">): string => (t.state === "done" && t.cancelled ? "cancelled" : STATE_LABEL[t.state].toLowerCase())
