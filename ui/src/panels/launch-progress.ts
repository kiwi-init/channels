import type { Launching, Person } from "~/model"

type Stage = "starting" | Launching["stage"]

export interface Launch {
  nick: string
  stage: Stage
  at: number
  before: ReadonlySet<string>
  handle?: string
  why?: string
}

export type Stall = "slow-start" | "not-asking" | "not-let-in" | "owner-waiting"

export const STALL_MS: Record<Stall, number> = {
  "slow-start": 45_000,
  "not-asking": 60_000,
  "not-let-in": 20_000,
  "owner-waiting": 90_000,
}

export function starting(nick: string, people: readonly Pick<Person, "name">[], at: number): Launch {
  return { nick, stage: "starting", at, before: new Set(people.map((p) => p.name)) }
}

export function seen(l: Launch, s: Launching, at: number): Launch {
  if (l.stage === "joined" || l.stage === "failed") return l
  if (s.stage === "failed") return { ...l, stage: "failed", at, why: s.why }
  if (s.stage === "started") return l.stage === "starting" ? { ...l, stage: "started", at } : l
  if (s.stage === "asked" && l.stage === "asked") return l
  return { ...l, stage: s.stage, at, handle: s.name }
}

export function joinedAs(l: Launch, people: readonly Pick<Person, "name" | "display">[]): string | null {
  if (l.stage === "failed") return null
  if (l.stage === "joined" && l.handle) return l.handle
  const fresh = people.filter((p) => !l.before.has(p.name))
  return (fresh.find((p) => p.name === l.handle) ?? fresh.find((p) => p.name === l.nick || p.display === l.nick))?.name ?? null
}

export function stepOf(l: Launch, youOwn: boolean, joined: boolean): number {
  if (joined) return youOwn ? 3 : 2
  if (l.stage === "starting" || l.stage === "failed") return 0
  return l.stage === "asked" && youOwn ? 2 : 1
}

export function stallOf(l: Launch, youOwn: boolean, joined: boolean, now: number): Stall | null {
  if (joined) return null
  const stall: Stall | null = l.stage === "starting" ? "slow-start" : l.stage === "started" ? (youOwn ? "not-asking" : "owner-waiting") : l.stage === "asked" && youOwn ? "not-let-in" : null
  return stall && now - l.at >= STALL_MS[stall] ? stall : null
}
