import type { Message } from "@kiwi/core/protocol.ts"
import { handoffOf } from "./handoff"

export interface AsksForMe {
  decisions: Message[]
  escalations: Message[]
  questions: Message[]
}

const isEscalationTo = (m: Message, me: string) => !!m.esc && !!m.to?.includes(me)

export function asksFor(openAsks: Message[], me: string): AsksForMe {
  const mine = openAsks.filter((m) => m.from !== me && (m.to?.includes(me) || m.to?.includes("*")))
  const decisions = mine.filter((m) => !!m.to?.includes(me) && !handoffOf(m))
  const rest = mine.filter((m) => !decisions.includes(m))
  return {
    decisions,
    escalations: rest.filter((m) => isEscalationTo(m, me)),
    questions: rest.filter((m) => !isEscalationTo(m, me)),
  }
}

export function askLabel(m: Message, me: string): string {
  if (isEscalationTo(m, me)) return "Decision for you"
  return m.to?.includes(me) ? "Question for you" : "Question for everyone"
}

export interface Chosen {
  choice: string
  by: string
  at: number
}

const letterOf = (choice: string) => /^([A-Z])\s*[:.)-]/.exec(choice)?.[1]

export function choiceIn(body: string, choices: readonly string[]): string | undefined {
  const said = body.trim()
  const exact = choices.find((c) => c.trim() === said)
  if (exact) return exact
  const letter = /^([A-Z])(?:\s*[:.)-]|\s*$)/.exec(said)?.[1]
  return letter ? choices.find((c) => letterOf(c) === letter) : undefined
}

export function chosenOf(ask: Message, replies: readonly Message[]): Chosen | undefined {
  if (!ask.choices?.length) return undefined
  const asked = ask.to ?? []
  for (const r of replies) {
    if (r.from === ask.from || r.kind === "event" || !r.re?.includes(ask.seq)) continue
    if (asked.length && !asked.includes("*") && !asked.includes(r.from)) continue
    const choice = choiceIn(r.body, ask.choices)
    if (choice) return { choice, by: r.from, at: r.ts }
  }
  return undefined
}

export function answered(asking: Message | undefined, named: readonly string[], replying: boolean): Message | undefined {
  return !replying && asking && (!named.length || named.includes(asking.from)) ? asking : undefined
}
