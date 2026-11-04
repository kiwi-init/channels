import { useEffect, useState, type RefObject } from "react"
import { createPortal } from "react-dom"

import { cleanExcerpt } from "~/chat/quote"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"

interface Picked {
  seq: number
  excerpt: string
  x: number
  y: number
  below: boolean
}

const ROOM_ABOVE = 64

function seqOf(node: Node, root: HTMLElement): number | null {
  const el = node instanceof Element ? node : node.parentElement
  if (!el || !root.contains(el)) return null
  const row = el.closest(".msg-body .md")?.closest<HTMLElement>("[data-seq]")
  const seq = row ? Number(row.dataset.seq) : NaN
  return Number.isInteger(seq) ? seq : null
}

function pickedIn(root: HTMLElement): Picked | null {
  const sel = document.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  const seq = seqOf(range.startContainer, root)
  if (seq === null) return null
  const end = seqOf(range.endContainer, root)
  if (end !== seq && !(range.endOffset === 0 && range.endContainer !== range.startContainer)) return null
  const excerpt = cleanExcerpt(sel.toString())
  if (!excerpt) return null
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  const box = root.getBoundingClientRect()
  const scroller = root.parentElement?.getBoundingClientRect() ?? box
  if (rect.bottom < scroller.top || rect.top > scroller.bottom || (!rect.width && !rect.height)) return null
  const below = rect.top - scroller.top < ROOM_ABOVE
  const x = Math.min(Math.max(rect.left + rect.width / 2, box.left + 48), box.right - 48)
  return { seq, excerpt, x, y: below ? rect.bottom : rect.top, below }
}

export function QuotePick({ root, onQuote }: { root: RefObject<HTMLElement | null>; onQuote: (seq: number, excerpt: string) => void }) {
  const [picked, setPicked] = useState<Picked | null>(null)
  useEffect(() => {
    let frame = 0
    const look = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const el = root.current
        setPicked(el ? pickedIn(el) : null)
      })
    }
    const up = (e: PointerEvent) => {
      if (e.button === 0) look()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPicked(null)
      else if (e.shiftKey || e.key === "Shift") look()
    }
    const changed = () => {
      const sel = document.getSelection()
      if (!sel || sel.isCollapsed) setPicked(null)
    }
    const moved = () => setPicked((was) => (was ? (root.current ? pickedIn(root.current) : null) : null))
    const away = () => setPicked(null)
    document.addEventListener("pointerup", up)
    document.addEventListener("keyup", key)
    document.addEventListener("selectionchange", changed)
    document.addEventListener("contextmenu", away, true)
    window.addEventListener("scroll", moved, true)
    window.addEventListener("resize", away)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener("pointerup", up)
      document.removeEventListener("keyup", key)
      document.removeEventListener("selectionchange", changed)
      document.removeEventListener("contextmenu", away, true)
      window.removeEventListener("scroll", moved, true)
      window.removeEventListener("resize", away)
    }
  }, [root])
  if (!picked) return null
  return createPortal(
    <button
      type="button"
      className={cx("quote-pick", picked.below && "is-below")}
      style={{ left: picked.x, top: picked.y }}
      title="Quote this in a reply"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onQuote(picked.seq, picked.excerpt)
        setPicked(null)
        document.getSelection()?.removeAllRanges()
      }}
    >
      <Icon name="reply" size={13} />
      Quote
    </button>,
    document.body
  )
}
