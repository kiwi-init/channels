export const trustedAt = (m: { ts: number; rts?: number }): number | undefined => m.rts;

export const heldBefore = (evidence: number | undefined, shipped: number | undefined): boolean => evidence !== undefined && shipped !== undefined && evidence <= shipped;

export function inOrderOfHappening<T>(items: readonly T[], happened: (item: T) => number | undefined): T[] {
  return items
    .map((item, arrived) => ({ item, arrived, at: happened(item) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.at - b.at || a.arrived - b.arrived)
    .map((x) => x.item);
}
