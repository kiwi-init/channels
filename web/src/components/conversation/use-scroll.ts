import { useEffect, useLayoutEffect, useRef, useState, type UIEvent } from "react"

import type { Message } from "@kiwi/core/protocol.ts"

const SMOOTH_MS = 500

export function useScroll({ messages, visible, hereKey }: { messages: Message[]; visible: Message[]; hereKey: string }) {
  const [behind, setBehind] = useState(0)

  const newest = messages.at(-1)?.seq ?? 0
  const [baseline, setBaseline] = useState<{ key: string; seq: number } | null>(null)
  if (newest && baseline?.key !== hereKey) setBaseline({ key: hereKey, seq: newest })
  const isFresh = (seq: number) => baseline !== null && baseline.key === hereKey && seq > baseline.seq

  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const lastCount = useRef(0)
  const lastTop = useRef(0)
  const smoothUntil = useRef(0)
  const followed = useRef<{ el: HTMLDivElement; stop: () => void } | null>(null)

  useLayoutEffect(() => {
    const el = scroller.current
    if (followed.current?.el === el) return
    followed.current?.stop()
    followed.current = null
    if (!el) return
    atBottom.current = true
    el.scrollTop = el.scrollHeight
    const content = el.firstElementChild
    const follow =
      content && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (atBottom.current && Date.now() > smoothUntil.current) el.scrollTop = el.scrollHeight
          })
        : null
    if (content) follow?.observe(content, { box: "border-box" })
    followed.current = { el, stop: () => follow?.disconnect() }
  })
  useEffect(() => () => followed.current?.stop(), [])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const added = visible.length - lastCount.current
    lastCount.current = visible.length
    const smooth = added > 0 && added < 4
    if (atBottom.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "instant" })
      if (!smooth) return
      smoothUntil.current = Date.now() + SMOOTH_MS
      const settle = setTimeout(() => {
        if (atBottom.current) el.scrollTop = el.scrollHeight
      }, SMOOTH_MS)
      return () => clearTimeout(settle)
    } else if (added > 0) setBehind((b) => b + added)
  }, [visible])
  useLayoutEffect(() => {
    atBottom.current = true
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [hereKey])

  const toBottom = () => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    setBehind(0)
  }

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    const up = el.scrollTop < lastTop.current - 2
    lastTop.current = el.scrollTop
    if (near) atBottom.current = true
    else if (up) atBottom.current = false
    if (atBottom.current && behind) setBehind(0)
  }

  const stick = () => {
    atBottom.current = true
  }

  return { behind, setBehind, isFresh, scroller, stick, toBottom, onScroll }
}
