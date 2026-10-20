import { useLayoutEffect, useRef, useState, type RefObject } from "react"

const WINDOW_STEP = 120
const MOUNTED_MAX = 2 * WINDOW_STEP
const NEAR_TOP = 600
const NEAR_BOTTOM = 80

const startOf = <T extends { seq: number }>(items: T[], count: number): number => items[Math.max(0, items.length - count)]?.seq ?? 0

export function trimmedFrom<T extends { seq: number }>(items: T[], hidden: number, aboveView: (seq: number) => boolean): number | null {
  if (items.length - hidden <= MOUNTED_MAX) return null
  const from = startOf(items, WINDOW_STEP)
  return aboveView(from) ? from : null
}

export function awayFrom<T extends { seq: number }>(items: T[], hidden: number): number | null {
  return items.length - hidden > MOUNTED_MAX ? startOf(items, WINDOW_STEP) : null
}

export function useWindow<T extends { seq: number }>(items: T[], hereKey: string, scroller: RefObject<HTMLDivElement | null>, reveal: number | null, showing: boolean) {
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
  const first = items.findIndex((m) => m.seq >= from)
  const hidden = Math.max(0, first)
  const away = showing ? null : awayFrom(items, hidden)
  if (away !== null && away !== from) setFrom(away)
  const keep = useRef<number | null>(null)
  const more = () => {
    const el = scroller.current
    if (el) keep.current = el.scrollHeight - el.scrollTop
    setFrom(startOf(items.slice(0, hidden), WINDOW_STEP))
  }
  const trim = (el: HTMLDivElement) => {
    const top = el.getBoundingClientRect().top
    const trimmed = trimmedFrom(items, hidden, (seq) => {
      const row = el.querySelector(`[id="m${seq}"]`)
      return row ? row.getBoundingClientRect().top < top : el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM
    })
    if (trimmed === null) return
    keep.current = el.scrollHeight - el.scrollTop
    setFrom(trimmed)
  }
  const onScrolled = (el: HTMLDivElement) => {
    if (keep.current !== null) return
    if (hidden && el.scrollTop < NEAR_TOP) return more()
    trim(el)
  }
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && keep.current === null) trim(el)
  })
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && keep.current !== null) el.scrollTo({ top: el.scrollHeight - keep.current, behavior: "instant" })
    keep.current = null
  }, [from, scroller])
  return { tail: hidden ? items.slice(hidden) : items, hidden, more, onScrolled }
}
