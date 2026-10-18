import type { FoldBase } from "@kiwi/core/state.ts"

export function baseFrom(since: number, firstSeq: number | undefined): number {
  return Math.min(since, (firstSeq ?? since + 1) - 1)
}

export function usableBase(snap: FoldBase | null, from: number): FoldBase | null {
  return snap && snap.n >= from ? snap : null
}
