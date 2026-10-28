import { marks } from "@kiwi/core/search-rank.ts"

const NAME = "search-hit"

export function paintHits(root: HTMLElement | null, wanted: string[]): Range | null {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return null
  if (!root || !wanted.length) {
    CSS.highlights.delete(NAME)
    return null
  }
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("time, button")) continue
    let at = 0
    for (const s of marks(node.textContent ?? "", wanted)) {
      if (s.hit) {
        const range = new Range()
        range.setStart(node, at)
        range.setEnd(node, at + s.text.length)
        ranges.push(range)
      }
      at += s.text.length
    }
  }
  CSS.highlights.set(NAME, new Highlight(...ranges))
  return ranges[0] ?? null
}
