import { useLayoutEffect, type RefObject } from "react"

const RIGID = "pre, table, img, svg, hr, video, iframe, .md-mermaid, .katex"
const BLOCK = "p, li, h1, h2, h3, h4, h5, h6, dd, dt, blockquote, div"
const SLACK = 1

const px = (v: string): number => Number.parseFloat(v) || 0

function edge(el: Element): number {
  const s = getComputedStyle(el)
  return px(s.paddingRight) + px(s.borderRightWidth)
}

function widest(bubble: HTMLElement): number | null {
  if (bubble.querySelector(RIGID)) return null
  const box = bubble.getBoundingClientRect()
  const after = new Map<Element, number>()
  const walk = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let need = 0
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const from = n.parentElement
    if (!from || !n.nodeValue?.trim()) continue
    let room = after.get(from)
    if (room === undefined) {
      const found = from.closest(BLOCK)
      const block = found && bubble.contains(found) ? found : bubble
      room = box.right - block.getBoundingClientRect().right + edge(block)
      for (let el: Element | null = from; el && el !== block; el = el.parentElement) room += edge(el)
      after.set(from, room)
    }
    range.selectNodeContents(n)
    for (const r of range.getClientRects()) need = Math.max(need, r.right - box.left + room)
  }
  return need > 0 && need + SLACK < box.width ? Math.ceil(need) + SLACK : null
}

const rows = new Map<Element, HTMLElement>()
let fonts: Promise<unknown> | null = null

function refitAfterFonts(): void {
  if (!("fonts" in document) || document.fonts.status !== "loading") return
  const ready = document.fonts.ready
  if (ready === fonts) return
  fonts = ready
  void ready.then(() => fit([...rows.keys()]))
}

function fit(due: readonly Element[]): void {
  const pairs = due.flatMap((row) => {
    const bubble = rows.get(row)
    return bubble?.isConnected && row instanceof HTMLElement ? [{ row, bubble }] : []
  })
  for (const { bubble } of pairs) bubble.style.width = ""
  const loose = pairs.map(({ row, bubble }) => ({ row, bubble, width: widest(bubble), height: row.offsetHeight }))
  for (const { bubble, width } of loose) if (width !== null) bubble.style.width = `${width}px`
  for (const { row, bubble, width, height } of loose) if (width !== null && row.offsetHeight !== height) bubble.style.width = ""
  refitAfterFonts()
}

const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => fit(entries.map((e) => e.target)))

export function useHug(ref: RefObject<HTMLElement | null>, on: boolean, content: unknown): void {
  useLayoutEffect(() => {
    const bubble = ref.current
    const row = on ? bubble?.closest("article") : null
    if (!bubble || !row) return
    rows.set(row, bubble)
    if (watch) watch.observe(row)
    else fit([row])
    return () => {
      watch?.unobserve(row)
      rows.delete(row)
      bubble.style.width = ""
    }
  }, [ref, on, content])
}
