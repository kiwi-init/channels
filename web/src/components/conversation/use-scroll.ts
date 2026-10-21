import { useEffect, useLayoutEffect, useRef, useState, type UIEvent } from "react"

import type { Message } from "@kiwi/core/protocol.ts"

const SMOOTH_MS = 500

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

export function scrolled(el: Scrolled, f: Follow): void {
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  const up = el.scrollTop < f.lastTop - 2
  f.lastTop = el.scrollTop
  if (near) f.atBottom = true
  else if (up) f.atBottom = false
}

export function useScroll({ messages, visible, hereKey }: { messages: Message[]; visible: Message[]; hereKey: string }) {
  const [behind, setBehind] = useState(0)

  const newest = messages.at(-1)?.seq ?? 0
  const [baseline, setBaseline] = useState<{ key: string; seq: number } | null>(null)
  if (newest && baseline?.key !== hereKey) setBaseline({ key: hereKey, seq: newest })
  const isFresh = (seq: number) => baseline !== null && baseline.key === hereKey && seq > baseline.seq

  const scroller = useRef<HTMLDivElement>(null)
  const follow = useRef<Follow>({ atBottom: true, lastTop: 0 })
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
    followed.current = { el, stop: () => observer?.disconnect() }
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
    scrolled(e.currentTarget, follow.current)
    if (follow.current.atBottom && behind) setBehind(0)
  }

  const stick = () => {
    follow.current.atBottom = true
  }

  return { behind, setBehind, isFresh, scroller, stick, toBottom, onScroll }
}
