const MENTION = /(^|\s)@([\p{L}\p{N}_.-]*)$/u
const LEADING = /^(?:\s*@([\p{L}\p{N}_.-]+)[\s,]*)+/u

export interface Person {
  name: string
  label: string
  agent: boolean
}

export function mentionQuery(text: string, caret: number): string | null {
  const m = MENTION.exec(text.slice(0, caret))
  return m ? (m[2] ?? "") : null
}

export function matchPeople(people: readonly Person[], query: string, limit = 6): Person[] {
  const q = query.toLowerCase()
  return people.filter((p) => p.name.toLowerCase().startsWith(q) || p.label.toLowerCase().startsWith(q)).slice(0, limit)
}

export function completeMention(text: string, caret: number, person: Pick<Person, "name">): { text: string; caret: number } {
  const before = text.slice(0, caret).replace(MENTION, (_all, pre: string) => `${pre}@${person.name} `)
  return { text: before + text.slice(caret), caret: before.length }
}

export function recipients(body: string, names: ReadonlySet<string>): string[] {
  const lead = LEADING.exec(body)?.[0] ?? ""
  return [...lead.matchAll(/@([\p{L}\p{N}_.-]+)/gu)].map((m) => m[1] ?? "").filter((n) => names.has(n))
}
