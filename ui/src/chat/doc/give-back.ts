const takers = new Set<(block: string) => void>()

export function onGiveBack(take: (block: string) => void): () => void {
  takers.add(take)
  return () => void takers.delete(take)
}

export function giveBackBlock(block: string): void {
  for (const take of takers) take(block)
}
