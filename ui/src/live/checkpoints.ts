import { checkpointAskStatus } from "@kiwi/core/state/checkpoint-asks.ts"
import type { ChannelState } from "@kiwi/core/state.ts"
import type { CheckpointAgent, CheckpointRound } from "~/model"

export function checkpointRoundOf(state: Pick<ChannelState, "checkpointAsks" | "tasks" | "facts">): CheckpointRound | undefined {
  const ask = state.checkpointAsks.at(-1)
  if (!ask) return undefined
  const agents = checkpointAskStatus(state, ask).map((a): CheckpointAgent => {
    if (a.reach === "unreachable") return { name: a.agent, state: "unreachable" }
    if (a.saved) return { name: a.agent, state: "saved" }
    const pending = a.items.filter((i) => i.state === "pending")
    return { name: a.agent, state: "pending", tasks: pending.flatMap((i) => (i.kind === "task" ? [i.task] : [])), lead: pending.some((i) => i.kind === "lead") }
  })
  return { seq: ask.seq, at: ask.at, daily: ask.occurrence !== null, agents }
}
