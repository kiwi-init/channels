import { useLayoutEffect, useRef, useState, type RefObject } from "react"

export const WINDOW_STEP = 120
const NEAR_TOP = 600

const startOf = <T extends { seq: number }>(items: T[], count: number): number => items[Math.max(0, items.length - count)]?.seq ?? 0

export function useWindow<T extends { seq: number }>(items: T[], hereKey: string, scroller: RefObject<HTMLDivElement | null>, reveal: number | null, all: boolean) {
  const [shownKey, setShownKey] = useState(hereKey)
  const [from, setFrom] = useState(() => startOf(items, WINDOW_STEP))
  if (shownKey !== hereKey) {
    setShownKey(hereKey)
    setFrom(startOf(items, WINDOW_STEP))
  }
  if (from === 0 && items.length > WINDOW_STEP) setFrom(startOf(items, WINDOW_STEP))
  if (reveal !== null && reveal < from && items.some((m) => m.seq === reveal))
    setFrom(
      startOf(
        items.filter((m) => m.seq <= reveal),
        WINDOW_STEP / 2
      )
    )
  const first = all ? -1 : items.findIndex((m) => m.seq >= from)
  const hidden = Math.max(0, first)
  const keep = useRef<number | null>(null)
  const more = () => {
    const el = scroller.current
    if (el) keep.current = el.scrollHeight - el.scrollTop
    setFrom(startOf(items.slice(0, hidden), WINDOW_STEP))
  }
  const onScrolled = (el: HTMLDivElement) => {
    if (hidden && keep.current === null && el.scrollTop < NEAR_TOP) more()
  }
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && keep.current !== null) el.scrollTo({ top: el.scrollHeight - keep.current, behavior: "instant" })
    keep.current = null
  }, [from, scroller])
  return { tail: hidden ? items.slice(hidden) : items, hidden, more, onScrolled }
}
