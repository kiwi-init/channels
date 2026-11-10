import type { Person, Spec, Task } from "~/model"
import { onePerPerson } from "~/names"
import { wordsRaw } from "~/words"

export function taskMatches(tasks: readonly Task[], query: string): Task[] {
  const q = query.trim().toLowerCase()
  const id = q.replace(/^t/, "")
  const score = (t: Task): number => {
    if (!q) return 0
    if (/^\d+$/.test(id) && String(t.id).startsWith(id)) return 0
    const title = wordsRaw(t.title).toLowerCase()
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

export const refDone = (query: string): boolean => /^\d+\s/.test(query)

export function specMatches(specs: readonly Spec[], query: string): Spec[] {
  const q = query.trim().toLowerCase()
  const score = (s: Spec): number => {
    if (!q) return 0
    if (/^\d+$/.test(q) && String(s.ask).startsWith(q)) return 0
    const title = wordsRaw(s.title).toLowerCase()
    if (title.startsWith(q)) return 1
    if (title.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q))) return 2
    return title.includes(q) ? 3 : -1
  }
  return specs
    .map((s) => ({ s, n: score(s) }))
    .filter((x) => x.n >= 0)
    .sort((a, b) => a.n - b.n || Number(!!a.s.result) - Number(!!b.s.result) || b.s.edited.at - a.s.edited.at)
    .slice(0, 4)
    .map((x) => x.s)
}

export function peopleMatches(people: readonly Person[], query: string): Person[] {
  const q = query.toLowerCase()
  return onePerPerson(people)
    .filter((p) => !p.you && (p.name.toLowerCase().startsWith(q) || p.display?.toLowerCase().startsWith(q)))
    .sort((a, b) => Number(b.presence === "online") - Number(a.presence === "online"))
    .slice(0, 6)
}
