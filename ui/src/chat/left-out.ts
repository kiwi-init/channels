import type { Message } from "~/model"

export function withLeftOut(list: readonly Message[], out: readonly Message[]): Message[] {
  const merged: Message[] = []
  let k = 0
  for (const m of list) {
    while (k < out.length && (m.seq < 0 || out[k]!.seq < m.seq)) merged.push(out[k++]!)
    merged.push(m)
  }
  return [...merged, ...out.slice(k)]
}

export function leftOutRun(list: readonly Message[], i: number): Message[] | null {
  if (!list[i]?.leftOut || list[i - 1]?.leftOut) return null
  let end = i
  while (list[end]?.leftOut) end++
  return list.slice(i, end)
}

export function runFirst(list: readonly Message[], i: number): number {
  let at = i
  while (at > 0 && list[at - 1]?.leftOut) at--
  return list[at]?.seq ?? 0
}

export function foldText(run: readonly Message[]): string {
  const forged = run.filter((m) => m.leftOut?.startsWith("Bad signature")).length
  const why = forged === run.length ? (run.length === 1 ? "bad signature" : "bad signatures") : forged === 0 ? "refused" : "bad signatures or refused"
  return `${run.length === 1 ? "1 message" : `${run.length} messages`} left out: ${why}`
}
