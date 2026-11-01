import type { Person } from "~/model"

interface WantedPersona {
  nick: string
  persona: string
  since: number
}

const wanted = new Map<string, WantedPersona>()

export function wantPersona(code: string, nick: string, persona: string, now: number = Date.now()): void {
  const name = nick.trim()
  if (!name) return
  const key = `${code}\0${name}`
  if (persona) wanted.set(key, { nick: name, persona, since: now })
  else wanted.delete(key)
}

export function arrivals(code: string, people: readonly Pick<Person, "name" | "display" | "kind" | "joined">[]): { name: string; persona: string }[] {
  const out: { name: string; persona: string }[] = []
  for (const [key, want] of wanted) {
    if (!key.startsWith(`${code}\0`)) continue
    const agent = people.find((p) => p.kind === "agent" && p.joined >= want.since && (p.display === want.nick || p.name === want.nick))
    if (!agent) continue
    wanted.delete(key)
    out.push({ name: agent.name, persona: want.persona })
  }
  return out
}
