import { useLayoutEffect, useRef, useState, type UIEvent } from "react"

import type { Message } from "@kiwi/core/protocol.ts"

export function useScroll({ messages, visible, hereKey }: { messages: Message[]; visible: Message[]; hereKey: string }) {
  const [behind, setBehind] = useState(0)

  const newest = messages.at(-1)?.seq ?? 0
  const [baseline, setBaseline] = useState<{ key: string; seq: number } | null>(null)
  if (newest && baseline?.key !== hereKey) setBaseline({ key: hereKey, seq: newest })
  const isFresh = (seq: number) => baseline !== null && baseline.key === hereKey && seq > baseline.seq

  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const lastCount = useRef(0)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const added = visible.length - lastCount.current
    lastCount.current = visible.length
    if (atBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: added > 0 && added < 4 ? "smooth" : "instant" })
    else if (added > 0) setBehind((b) => b + added)
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
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (atBottom.current && behind) setBehind(0)
  }

  const stick = () => {
    atBottom.current = true
  }

  return { behind, setBehind, isFresh, scroller, stick, toBottom, onScroll }
}
