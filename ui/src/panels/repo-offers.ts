export function repoOffers(mine: readonly string[], have: readonly string[]): string[] {
  const taken = new Set(have.map((r) => r.toLowerCase()))
  return mine.filter((r) => !taken.has(r.toLowerCase()))
}
