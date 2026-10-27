import type { Task } from "@kiwi/core/state.ts"

export function taskMatches(task: Task, query: string | null): boolean {
  const q = query?.trim().toLowerCase() ?? ""
  if (!q) return true
  const id = /^t?(\d+)$/i.exec(q)
  return id ? task.id === Number(id[1]) : task.title.toLowerCase().includes(q)
}

export function matchingTasks(tasks: Iterable<Task>, query: string | null): Task[] {
  if (!query?.trim()) return []
  return [...tasks].filter((task) => taskMatches(task, query)).sort((a, b) => b.updatedAt - a.updatedAt || a.id - b.id)
}
