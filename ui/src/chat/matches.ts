import type { Person, Task } from "~/model"
import { onePerPerson } from "~/names"

export function taskMatches(tasks: readonly Task[], query: string): Task[] {
  const q = query.trim().toLowerCase()
  const id = q.replace(/^t/, "")
  const score = (t: Task): number => {
    if (!q) return 0
    if (/^\d+$/.test(id) && String(t.id).startsWith(id)) return 0
    const title = t.title.toLowerCase()
    if (title.startsWith(q)) return 1
    if (title.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q))) return 2
    return title.includes(q) ? 3 : -1
  }
  return tasks
    .filter((t) => !t.archived)
    .map((t) => ({ t, s: score(t) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || Number(a.t.status === "done") - Number(b.t.status === "done") || b.t.updatedAt - a.t.updatedAt)
    .slice(0, 6)
    .map((x) => x.t)
}

export function peopleMatches(people: readonly Person[], query: string): Person[] {
  const q = query.toLowerCase()
  return onePerPerson(people)
    .filter((p) => !p.you && (p.name.toLowerCase().startsWith(q) || p.display?.toLowerCase().startsWith(q)))
    .sort((a, b) => Number(b.presence === "online") - Number(a.presence === "online"))
    .slice(0, 6)
}
