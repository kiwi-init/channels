import type { Message } from "@kiwi/core/protocol.ts"
import type { Task } from "@kiwi/core/state.ts"

export type Tasks = ReadonlyMap<number, Pick<Task, "state">>

const DIGEST = /^T(\d+) (?:done|cancelled):/

export function digestTask(m: Message): number | null {
  if (m.kind !== "done") return null
  const hit = DIGEST.exec(m.body)
  return hit ? Number(hit[1]) : null
}

export function isActivity(m: Message, tasks: Tasks): boolean {
  if (m.kind === "event") return true
  const id = digestTask(m)
  return id !== null && tasks.has(id)
}
