import { sameDay } from "~/kit/time"
import type { Message } from "~/model"

const isUpdate = (m: Message): boolean => !!m.system && !m.leftOut

export function splitUpdates(list: readonly Message[]): { talk: Message[]; runs: Message[][] } {
  const talk: Message[] = []
  const runs: Message[][] = []
  let run: Message[] | null = null
  for (const m of list) {
    if (!isUpdate(m)) {
      talk.push(m)
      run = null
    } else if (run?.[0] && sameDay(run[0].at, m.at)) run.push(m)
    else runs.push((run = [m]))
  }
  return { talk, runs }
}
