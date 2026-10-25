import type { TaskState } from "@kiwi/core/protocol.ts"
import type { ChannelState, Task } from "@kiwi/core/state.ts"
import { statusOf, statusWord } from "@kiwi/core/status.ts"

export const STATE_LABEL: Record<TaskState, string> = { todo: "Up next", doing: "In progress", review: "In review", done: "Done" }

export const DONE_RECENTLY = "Done this week"

export const DECISION = "Needs a decision"

export const YOUR_REVIEW = "Ready for your review"

export const stateWord = (state: ChannelState, t: Task): string => statusWord(statusOf(state, t))

export const labelOf = (state: ChannelState, t: Task): string => {
  const word = stateWord(state, t)
  return word.charAt(0).toUpperCase() + word.slice(1)
}
