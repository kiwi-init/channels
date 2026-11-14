import type { Channel, QuestionAsk } from "~/model"
import { wordsPlain, wordsSame } from "~/words"

const CUT = 80

export interface Earlier {
  chose: boolean
  text: string
  at: number
}

const workOf = (a: Pick<QuestionAsk, "task" | "holds">): number[] => [...(a.task !== undefined ? [a.task] : []), ...a.holds]

export function earlierAnswer(channel: Pick<Channel, "asks" | "you" | "nicknames">, ask: QuestionAsk): Earlier | null {
  const work = new Set(workOf(ask))
  if (!work.size) return null
  let last: Earlier | null = null
  for (const a of channel.asks) {
    if (a.kind !== "question" || a.id === ask.id || a.handoff || a.answer?.by !== channel.you) continue
    const answer = a.answer
    if ((last && last.at >= answer.at) || !workOf(a).some((id) => work.has(id))) continue
    const plain = wordsPlain(answer.text, channel.nicknames).replace(/\s+/g, " ").trim()
    last = { chose: a.options.some((o) => wordsSame(o, answer.text)), text: plain.length > CUT ? `${plain.slice(0, CUT - 1).trimEnd()}…` : plain, at: answer.at }
  }
  return last
}
