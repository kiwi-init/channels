import type { TaskState } from "@mc/protocol.ts"
import { taskId, type Task } from "@mc/state.ts"

export { taskId }

const LABEL: Record<TaskState, string> = { doing: "In progress", review: "In review", todo: "Open", done: "Done" }

const ORDER: Record<TaskState, number> = { doing: 0, review: 1, todo: 2, done: 3 }

export function labelOf(task: Pick<Task, "state" | "cancelled">): string {
  return task.state === "done" && task.cancelled ? "Done (cancelled)" : LABEL[task.state]
}

export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.updatedAt - a.updatedAt)
}

export function roundLine(round: Task["rounds"][number], nameOf: (name: string) => string): string {
  const result = round.result
  const outcome = result.kind === "open" ? "waiting" : result.kind === "withdrawn" ? "withdrawn" : `${result.kind} by ${nameOf(result.by)}`
  return `Round ${round.n}, asked by ${nameOf(round.by)}: ${outcome}`
}
