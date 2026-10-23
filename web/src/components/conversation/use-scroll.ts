import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from "react"

import type { Message } from "@kiwi/core/protocol.ts"

const SMOOTH_MS = 500
const THEIRS_MS = 1000
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "])

export function arrivedAfter(visible: readonly Pick<Message, "seq">[], seen: number): number {
  return seen ? visible.filter((m) => m.seq > seen).length : visible.length
}

export interface Scrolled {
  scrollTop: number
  readonly scrollHeight: number
  readonly clientHeight: number
}

export interface Follow {
  atBottom: boolean
  lastTop: number
  theirsUntil: number
}

export function touched(f: Follow, now: number, holding = false): void {
  f.theirsUntil = holding ? Infinity : now + THEIRS_MS
}

export function pin(el: Scrolled, f: Follow): void {
  el.scrollTop = el.scrollHeight
  f.lastTop = el.scrollTop
}

export function resized(el: Scrolled, f: Follow, smoothing: boolean): void {
  if (!f.atBottom) return
  if (smoothing) f.lastTop = el.scrollTop
  else pin(el, f)
}

export function scrolled(el: Scrolled, f: Follow, now: number): void {
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  const up = el.scrollTop < f.lastTop - 2
  f.lastTop = el.scrollTop
  if (near) f.atBottom = true
  else if (up && now < f.theirsUntil) f.atBottom = false
}

function scrollsByKey(e: KeyboardEvent): boolean {
  const at = e.target
  return SCROLL_KEYS.has(e.key) && !(at instanceof HTMLElement && (at.isContentEditable || at.closest("input, textarea, select")))
}

export function useScroll({ messages, visible, hereKey }: { messages: Message[]; visible: Message[]; hereKey: string }) {
  const [behind, setBehind] = useState(0)

  const newest = messages.at(-1)?.seq ?? 0
  const [baseline, setBaseline] = useState<{ key: string; seq: number } | null>(null)
  if (newest && baseline?.key !== hereKey) setBaseline({ key: hereKey, seq: newest })
  const isFresh = (seq: number) => baseline !== null && baseline.key === hereKey && seq > baseline.seq

  const scroller = useRef<HTMLDivElement>(null)
  const follow = useRef<Follow>({ atBottom: true, lastTop: 0, theirsUntil: 0 })
  const lastSeq = useRef(0)
  const smoothUntil = useRef(0)
  const followed = useRef<{ el: HTMLDivElement; stop: () => void } | null>(null)

  useLayoutEffect(() => {
    const el = scroller.current
    if (followed.current?.el === el) return
    followed.current?.stop()
    followed.current = null
    if (!el) return
    follow.current.atBottom = true
    pin(el, follow.current)
    const content = el.firstElementChild
    const observer = content && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resized(el, follow.current, Date.now() <= smoothUntil.current)) : null
    if (content) observer?.observe(content, { box: "border-box" })
    const touch = () => touched(follow.current, Date.now())
    const hold = () => touched(follow.current, Date.now(), true)
    const key = (e: KeyboardEvent) => {
      if (scrollsByKey(e)) touch()
    }
    el.addEventListener("wheel", touch, { passive: true })
    el.addEventListener("touchmove", touch, { passive: true })
    el.addEventListener("pointerdown", hold)
    window.addEventListener("pointerup", touch)
    window.addEventListener("pointercancel", touch)
    window.addEventListener("keydown", key)
    followed.current = {
      el,
      stop: () => {
        observer?.disconnect()
        el.removeEventListener("wheel", touch)
        el.removeEventListener("touchmove", touch)
        el.removeEventListener("pointerdown", hold)
        window.removeEventListener("pointerup", touch)
        window.removeEventListener("pointercancel", touch)
        window.removeEventListener("keydown", key)
      },
    }
  })
  useEffect(
    () => () => {
      followed.current?.stop()
      followed.current = null
    },
    []
  )

  useLayoutEffect(() => {
    follow.current.atBottom = true
    lastSeq.current = -1
    const el = scroller.current
    if (el) pin(el, follow.current)
  }, [hereKey])
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const added = lastSeq.current < 0 ? 0 : arrivedAfter(visible, lastSeq.current)
    lastSeq.current = Math.max(lastSeq.current, visible.at(-1)?.seq ?? 0)
    const smooth = added > 0 && added < 4
    if (follow.current.atBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "instant" })
      follow.current.lastTop = el.scrollTop
      if (!smooth) return
      smoothUntil.current = Date.now() + SMOOTH_MS
      const settle = setTimeout(() => {
        if (follow.current.atBottom) pin(el, follow.current)
      }, SMOOTH_MS)
      return () => clearTimeout(settle)
    } else if (added > 0) setBehind((b) => b + added)
  }, [visible])

  const toBottom = () => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    setBehind(0)
  }

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    scrolled(e.currentTarget, follow.current, Date.now())
    if (follow.current.atBottom && behind) setBehind(0)
  }

  const stick = () => {
    follow.current.atBottom = true
  }

  const theirs = useCallback(() => touched(follow.current, Date.now()), [])

  return { behind, setBehind, isFresh, scroller, stick, theirs, toBottom, onScroll }
}
