import type { Task } from "@kiwi/core/state.ts"

import { buildIndex, rank } from "./search-rank"

const idOf = (query: string) => {
  const id = /^t?(\d+)$/i.exec(query.trim())
  return id ? Number(id[1]) : null
}

export function taskMatches(task: Task, query: string | null): boolean {
  const q = query?.trim().toLowerCase() ?? ""
  if (!q) return true
  const id = idOf(q)
  return id !== null ? task.id === id : task.title.toLowerCase().includes(q)
}

export function matchingTasks(tasks: Iterable<Task>, query: string | null): Task[] {
  if (!query?.trim()) return []
  const all = [...tasks]
  const id = idOf(query)
  if (id !== null) return all.filter((task) => task.id === id)
  const ranked = rank(buildIndex(all.map((task) => ({ item: task, fields: [{ text: task.title, weight: 1 }] }))), query)
  return ranked.sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt).map((r) => r.item)
}
