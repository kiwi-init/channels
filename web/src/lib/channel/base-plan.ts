import { olderRules } from "@kiwi/core/protocol.ts"
import type { FoldBase } from "@kiwi/core/state.ts"

import { wholeLog } from "../history-plan"

export function baseFrom(since: number, firstSeq: number | undefined): number {
  return Math.min(since, (firstSeq ?? since + 1) - 1)
}

export function usableBase(snap: FoldBase | null, from: number): FoldBase | null {
  return snap && snap.n >= from ? snap : null
}

export function newestRules(bases: readonly (FoldBase | null)[]): FoldBase | null {
  const present = bases.filter((b): b is FoldBase => b !== null)
  const reach = Math.max(-1, ...present.filter(olderRules).map((b) => b.n))
  return present.find((b) => !olderRules(b) && b.n >= reach) ?? present.find((b) => olderRules(b) && b.n === reach) ?? present[0] ?? null
}

export function startsWhole(head: number, limit: number, since: number, firstSeq: number | undefined, base: FoldBase | null): boolean {
  return wholeLog(head, limit, firstSeq) || usableBase(base, baseFrom(since, firstSeq)) !== null
}
