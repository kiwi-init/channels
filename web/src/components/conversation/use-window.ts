import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"

export const WINDOW_STEP = 120

export function useWindow<T extends { seq: number }>(items: T[], hereKey: string, scroller: RefObject<HTMLDivElement | null>, reveal: number | null, all: boolean) {
  const [shownKey, setShownKey] = useState(hereKey)
  const [limit, setLimit] = useState(WINDOW_STEP)
  if (shownKey !== hereKey) {
    setShownKey(hereKey)
    setLimit(WINDOW_STEP)
  }
  const at = reveal === null ? -1 : items.findIndex((m) => m.seq === reveal)
  if (at >= 0 && items.length - at > limit) setLimit(items.length - at + WINDOW_STEP / 2)
  const hidden = all ? 0 : Math.max(0, items.length - limit)
  const keep = useRef<number | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const more = () => {
    const el = scroller.current
    if (el) keep.current = el.scrollHeight - el.scrollTop
    setLimit((l) => l + WINDOW_STEP)
  }
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && keep.current !== null) el.scrollTo({ top: el.scrollHeight - keep.current, behavior: "instant" })
    keep.current = null
  }, [limit, scroller])
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hidden) return
    const watch = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        const box = scroller.current
        if (box) keep.current = box.scrollHeight - box.scrollTop
        setLimit((l) => l + WINDOW_STEP)
      },
      { root: scroller.current, rootMargin: "800px 0px 0px 0px" }
    )
    watch.observe(el)
    return () => watch.disconnect()
  }, [hidden, limit, scroller])
  return { tail: hidden ? items.slice(hidden) : items, hidden, more, sentinel }
}
