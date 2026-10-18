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
