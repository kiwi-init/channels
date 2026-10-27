import { marks } from "./search-rank"

const NAME = "search-hit"

export function paintHits(root: HTMLElement | null, wanted: string[]): void {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return
  if (!root || !wanted.length) {
    CSS.highlights.delete(NAME)
    return
  }
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root.querySelector(".bubble-text") ?? root, NodeFilter.SHOW_TEXT)
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
}
