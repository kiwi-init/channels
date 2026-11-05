import type { Message } from "@kiwi/core/protocol.ts"

export interface DocBase {
  n: number
  docs?: readonly (readonly [string, string])[]
}

export interface DocLog {
  snapshot: () => Promise<DocBase | null>
  history: (since: number) => Promise<{ messages: readonly Message[] }>
}

export function firstDoc(base: DocBase | null, messages: readonly Message[], thread: string): string | null {
  const kept = base?.docs?.find(([t]) => t === thread)?.[1]
  if (kept) return kept
  let first: { seq: number; th: string } | null = null
  for (const m of messages) {
    const ev = m.ev
    if (ev?.op === "doc.open" && ev.thread === thread && (!first || m.seq < first.seq)) first = { seq: m.seq, th: ev.th }
  }
  return first?.th ?? null
}

const found = new Map<string, string>()

export async function findDoc(log: DocLog, key: string, thread: string): Promise<string | null> {
  const known = found.get(`${key}\n${thread}`)
  if (known) return known
  const snap = await log.snapshot().catch(() => null)
  const base = snap?.docs ? snap : null
  const { messages } = await log.history(base?.n ?? 0)
  const th = firstDoc(base, messages, thread)
  if (th) found.set(`${key}\n${thread}`, th)
  return th
}
