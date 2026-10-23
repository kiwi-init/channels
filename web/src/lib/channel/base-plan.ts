import type { FoldBase } from "@kiwi/core/state.ts";

import { wholeLog } from "../history-plan";

export function baseFrom(since: number, firstSeq: number | undefined): number {
  return Math.min(since, (firstSeq ?? since + 1) - 1);
}

export function usableBase(snap: FoldBase | null, from: number): FoldBase | null {
  return snap && snap.n >= from ? snap : null;
}

export function startsWhole(head: number, limit: number, since: number, firstSeq: number | undefined, base: FoldBase | null): boolean {
  return wholeLog(head, limit, firstSeq) || usableBase(base, baseFrom(since, firstSeq)) !== null;
}
