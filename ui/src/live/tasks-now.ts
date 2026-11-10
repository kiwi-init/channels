import { useMemo } from "react"

import type { Message as Wire } from "@kiwi/core/protocol.ts"
import type { ChannelState } from "@kiwi/core/state.ts"
import { useNow } from "~/kit/time"
import { tasksOf } from "~/live/map"
import type { Task } from "~/model"
import { TASK_TICK_MS } from "~/tasks/tick"

export function useTasksNow(state: ChannelState, held: ReadonlySet<number>, me: string, messages: readonly Wire[], every: number = TASK_TICK_MS): Task[] {
  const now = useNow(every)
  return useMemo(() => tasksOf(state, held, me, messages, now), [state, held, me, messages, now])
}
