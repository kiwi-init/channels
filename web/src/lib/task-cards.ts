import type { Message } from "@kiwi/core/protocol.ts"
import type { Task } from "@kiwi/core/state.ts"

type Tasks = ReadonlyMap<number, Pick<Task, "state">>

export function taskOfEvent(m: Message): number | null {
  if (m.kind !== "event" || !m.ev) return null
  if (m.ev.op === "task.add") return m.seq
  return "task" in m.ev && typeof m.ev.task === "number" ? m.ev.task : null
}

export function isTaskCard(m: Message, tasks: Tasks): boolean {
  if (m.ev?.op !== "task.add") return false
  const task = tasks.get(m.seq)
  return !!task && task.state !== "done"
}

export function foldTaskEvents(list: readonly Message[], tasks: Tasks): Message[] {
  const last = new Map<number, number>()
  for (const m of list) {
    const task = taskOfEvent(m)
    if (task !== null) last.set(task, m.seq)
  }
  return list.filter((m) => {
    const id = taskOfEvent(m)
    const task = id === null ? undefined : tasks.get(id)
    if (!task) return true
    return task.state === "done" ? last.get(id!) === m.seq : m.ev?.op === "task.add"
  })
}
