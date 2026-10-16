import type { Message } from "@mc/protocol.ts"

export interface AsksForMe {
  escalations: Message[]
  questions: Message[]
}

const isEscalationTo = (m: Message, me: string) => !!m.esc && !!m.to?.includes(me)

export function asksFor(openAsks: Message[], me: string): AsksForMe {
  const mine = openAsks.filter((m) => m.from !== me && (m.to?.includes(me) || m.to?.includes("*")))
  return {
    escalations: mine.filter((m) => isEscalationTo(m, me)),
    questions: mine.filter((m) => !isEscalationTo(m, me)),
  }
}

export function askLabel(m: Message, me: string): string {
  if (isEscalationTo(m, me)) return "Decision for you"
  return m.to?.includes(me) ? "Question for you" : "Question for everyone"
}
