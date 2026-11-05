import type { Message as Wire } from "@kiwi/core/protocol.ts"

export function withReach(reach: readonly Wire[], shown: readonly Wire[], asks: readonly Wire[]): readonly Wire[] {
  const first = shown[0]?.seq ?? Infinity
  const held = new Set(shown.map((m) => m.seq))
  const older = reach.filter((m) => m.seq < first)
  const missing = asks.filter((m) => !held.has(m.seq))
  if (!older.length && !missing.length) return shown
  const bySeq = new Map<number, Wire>()
  for (const m of older) bySeq.set(m.seq, m)
  for (const m of missing) bySeq.set(m.seq, m)
  for (const m of shown) bySeq.set(m.seq, m)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}
