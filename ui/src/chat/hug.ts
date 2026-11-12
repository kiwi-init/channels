import { useLayoutEffect, type RefObject } from "react"

const RIGID = "pre, table, img, svg, hr, video, iframe, .md-mermaid, .katex"
const BLOCK = "p, li, h1, h2, h3, h4, h5, h6, dd, dt, blockquote, div"
const SLACK = 1

interface Measured {
  width: number | null
  natural: number
  grow: number
}

interface Fitted extends Measured {
  room: number
  tall: number
}

interface Hugged {
  bubble: HTMLElement
  last: Fitted | null
}

const px = (v: string): number => Number.parseFloat(v) || 0

function edge(el: Element): number {
  const s = getComputedStyle(el)
  return px(s.paddingRight) + px(s.borderRightWidth)
}

function measure(bubble: HTMLElement): Measured {
  const box = bubble.getBoundingClientRect()
  if (bubble.querySelector(RIGID)) return { width: null, natural: box.width, grow: Infinity }
  const blocks = new Map<Element, { after: number; lines: Set<number>; text: number }>()
  const places = new Map<Element, { after: number; block: { lines: Set<number>; text: number } }>()
  const walk = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let need = 0
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const from = n.parentElement
    if (!from || !n.nodeValue?.trim()) continue
    let place = places.get(from)
    if (!place) {
      const found = from.closest(BLOCK)
      const el = found && bubble.contains(found) ? found : bubble
      let block = blocks.get(el)
      if (!block) {
        block = { after: box.right - el.getBoundingClientRect().right + edge(el), lines: new Set(), text: 0 }
        blocks.set(el, block)
      }
      let after = block.after
      for (let up: Element | null = from; up && up !== el; up = up.parentElement) after += edge(up)
      place = { after, block }
      places.set(from, place)
    }
    range.selectNodeContents(n)
    for (const r of range.getClientRects()) {
      need = Math.max(need, r.right - box.left + place.after)
      place.block.lines.add(Math.round(r.top))
      place.block.text += r.width
    }
  }
  let grow = Infinity
  for (const { lines, text } of blocks.values()) if (lines.size > 1) grow = Math.min(grow, text / (lines.size - 1))
  return { width: need > 0 && need + SLACK < box.width ? Math.ceil(need) + SLACK : null, natural: box.width, grow }
}

function roomFor(bubble: HTMLElement): number {
  const { width, maxWidth } = bubble.style
  bubble.style.width = "100000px"
  bubble.style.maxWidth = "100%"
  const room = bubble.getBoundingClientRect().width
  bubble.style.width = width
  bubble.style.maxWidth = maxWidth
  return room
}

function holds(last: Fitted, room: number, tall: number): boolean {
  if (last.tall !== tall) return false
  if (room === last.room) return true
  if (last.width !== null) return last.width <= room && (room < last.room || room < last.grow)
  return last.natural < last.room - SLACK && last.natural <= room
}

const rows = new Map<Element, Hugged>()
let fonts: Promise<unknown> | null = null

function refitAfterFonts(): void {
  if (!("fonts" in document) || document.fonts.status !== "loading") return
  const ready = document.fonts.ready
  if (ready === fonts) return
  fonts = ready
  void ready.then(() => fit(rows.keys(), true))
}

function fit(due: Iterable<Element>, all = false): void {
  const seen = [...due].flatMap((row) => {
    const hugged = rows.get(row)
    return hugged?.bubble.isConnected && row instanceof HTMLElement ? [{ row, hugged, tall: row.offsetHeight }] : []
  })
  const rooms = new Map<Element | null, number>()
  const stale = seen.flatMap(({ row, hugged, tall }) => {
    let room = rooms.get(row.parentElement)
    if (room === undefined) {
      room = roomFor(hugged.bubble)
      rooms.set(row.parentElement, room)
    }
    if (!all && hugged.last && holds(hugged.last, room, tall)) {
      hugged.last.room = room
      return []
    }
    return [{ row, hugged, room }]
  })
  for (const { hugged } of stale) hugged.bubble.style.width = ""
  const loose = stale.map(({ row, hugged, room }) => ({ row, hugged, room, tall: row.offsetHeight, ...measure(hugged.bubble) }))
  for (const { hugged, width } of loose) if (width !== null) hugged.bubble.style.width = `${width}px`
  for (const { row, hugged, room, tall, width, natural, grow } of loose) {
    const kept = width !== null && row.offsetHeight === tall
    if (width !== null && !kept) hugged.bubble.style.width = ""
    hugged.last = { room, tall, width: kept ? width : null, natural, grow }
  }
  refitAfterFonts()
}

const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => fit(entries.map((e) => e.target)))

export function useHug(ref: RefObject<HTMLElement | null>, on: boolean, content: unknown): void {
  useLayoutEffect(() => {
    const bubble = ref.current
    const row = on ? bubble?.closest("article") : null
    if (!bubble || !row) return
    rows.set(row, { bubble, last: null })
    if (watch) watch.observe(row)
    else fit([row])
    return () => {
      watch?.unobserve(row)
      rows.delete(row)
      bubble.style.width = ""
    }
  }, [ref, on, content])
}
