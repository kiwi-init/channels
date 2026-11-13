import "~/i18n/en/chat-later"
import { useEffect, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"

import { cleanExcerpt } from "~/chat/quote"
import { t } from "~/i18n/i18n"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"

type QuoteSource = { kind: "message"; seq: number } | { kind: "task"; task: number }

interface Picked {
  source: QuoteSource
  excerpt: string
  x: number
  y: number
  below: boolean
}

const ROOM_ABOVE = 64
const MESSAGE_TEXT = ".msg-body .md"

function numberIn(el: HTMLElement | null | undefined, key: "seq" | "quoteTask"): number | null {
  const n = el ? Number(el.dataset[key]) : NaN
  return Number.isInteger(n) ? n : null
}

function sourceOf(node: Node, root: HTMLElement, body: string): { source: QuoteSource; text: Element } | null {
  const el = node instanceof Element ? node : node.parentElement
  if (!el || !root.contains(el)) return null
  const text = el.closest(body)
  if (!text) return null
  const described = text.closest<HTMLElement>("[data-quote-task]")
  if (described) {
    const task = numberIn(described, "quoteTask")
    return task === null ? null : { source: { kind: "task", task }, text }
  }
  const seq = numberIn(text.closest<HTMLElement>("[data-seq]"), "seq")
  return seq === null ? null : { source: { kind: "message", seq }, text }
}

function onlyIn(range: Range, text: Element): boolean {
  const inside = document.createRange()
  inside.selectNodeContents(text)
  if (range.compareBoundaryPoints(Range.START_TO_START, inside) < 0) return false
  const clipped = range.cloneRange()
  if (clipped.compareBoundaryPoints(Range.END_TO_END, inside) > 0) clipped.setEnd(inside.endContainer, inside.endOffset)
  return clipped.toString().trim() === range.toString().trim()
}

const sameSource = (a: QuoteSource, b: QuoteSource | null): boolean => b !== null && (a.kind === "message" ? b.kind === "message" && b.seq === a.seq : b.kind === "task" && b.task === a.task)

function pickedIn(root: HTMLElement, body: string, tasks: boolean): Picked | null {
  const sel = document.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  const start = sourceOf(range.startContainer, root, body)
  if (start === null || (start.source.kind === "task" && !tasks)) return null
  const source = start.source
  const end = sourceOf(range.endContainer, root, body)
  if (!sameSource(source, end?.source ?? null) && !(range.endOffset === 0 && onlyIn(range, start.text))) return null
  const excerpt = cleanExcerpt(sel.toString())
  if (!excerpt) return null
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  const box = root.getBoundingClientRect()
  const scroller = root.parentElement?.getBoundingClientRect() ?? box
  if (rect.bottom < scroller.top || rect.top > scroller.bottom || (!rect.width && !rect.height)) return null
  const below = rect.top - scroller.top < ROOM_ABOVE
  const x = Math.min(Math.max(rect.left + rect.width / 2, box.left + 48), box.right - 48)
  return { source, excerpt, x, y: below ? rect.bottom : rect.top, below }
}

export function QuotePick({
  root,
  onQuote,
  onQuoteTask,
  body = MESSAGE_TEXT,
}: {
  root: RefObject<HTMLElement | null>
  onQuote: (seq: number, excerpt: string) => void
  onQuoteTask?: (task: number, excerpt: string) => void
  body?: string
}) {
  const tasks = onQuoteTask !== undefined
  const [picked, setPicked] = useState<Picked | null>(null)
  const showing = useRef(false)
  useEffect(() => {
    showing.current = picked !== null
  }, [picked])
  useEffect(() => {
    let frame = 0
    const look = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const el = root.current
        setPicked(el ? pickedIn(el, body, tasks) : null)
      })
    }
    const up = (e: PointerEvent) => {
      if (e.button === 0) look()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPicked(null)
      else if (e.shiftKey || e.key === "Shift") look()
    }
    const dismiss = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !showing.current) return
      e.preventDefault()
      setPicked(null)
    }
    const changed = () => {
      if (!showing.current) return
      const sel = document.getSelection()
      if (!sel || sel.isCollapsed) setPicked(null)
    }
    const moved = () => setPicked((was) => (was ? (root.current ? pickedIn(root.current, body, tasks) : null) : null))
    const away = () => setPicked(null)
    document.addEventListener("pointerup", up)
    document.addEventListener("keyup", key)
    document.addEventListener("keydown", dismiss, true)
    document.addEventListener("selectionchange", changed)
    document.addEventListener("contextmenu", away, true)
    window.addEventListener("scroll", moved, true)
    window.addEventListener("resize", away)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener("pointerup", up)
      document.removeEventListener("keyup", key)
      document.removeEventListener("keydown", dismiss, true)
      document.removeEventListener("selectionchange", changed)
      document.removeEventListener("contextmenu", away, true)
      window.removeEventListener("scroll", moved, true)
      window.removeEventListener("resize", away)
    }
  }, [root, body, tasks])
  if (!picked) return null
  return createPortal(
    <button
      type="button"
      className={cx("quote-pick", picked.below && "is-below")}
      style={{ left: picked.x, top: picked.y }}
      title={t("chat.quote.pick.title")}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (picked.source.kind === "message") onQuote(picked.source.seq, picked.excerpt)
        else onQuoteTask?.(picked.source.task, picked.excerpt)
        setPicked(null)
        document.getSelection()?.removeAllRanges()
      }}
    >
      <Icon name="reply" size={13} />
      {t("chat.quote.pick.quote")}
    </button>,
    document.body
  )
}
