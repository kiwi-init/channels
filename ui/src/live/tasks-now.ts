import { useMemo } from "react"

import type { Message as Wire } from "@kiwi/core/protocol.ts"
import type { ChannelState } from "@kiwi/core/state.ts"
import { useNow } from "~/kit/time"
import { useBoard, useStable } from "~/live/board"
import { historyOf, tasksFrom } from "~/live/map"
import type { Task } from "~/model"
import { TASK_TICK_MS } from "~/tasks/tick"

export function useTasksNow(state: ChannelState, held: ReadonlySet<number>, me: string, messages: readonly Wire[], every: number = TASK_TICK_MS): Task[] {
  const now = useNow(every)
  const board = useBoard(state)
  const history = useStable(useMemo(() => historyOf(state, messages, me), [state, messages, me]))
  const holding = useStable(held)
  return useMemo(() => tasksFrom(board, holding, me, history, now), [board, holding, me, history, now])
}
