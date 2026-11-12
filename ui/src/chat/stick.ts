import { useCallback, useLayoutEffect, useRef } from "react"

const NEAR_BOTTOM = 48

const WHEEL_MS = 400

const RESTORE_HOLD_MS = 4_000

interface Anchor {
  el: Element
  seq: number
  top: number
  at: number
  under: number
  tall: number
}

const gapIn = (box: HTMLElement): number => box.scrollHeight - box.scrollTop - box.clientHeight

const laidOut = (el: Element): boolean => el.isConnected && el.getClientRects().length > 0

const aside = (el: Element): boolean => el.hasAttribute("data-aside")

function endOf(list: HTMLElement): number {
  let last = list.lastElementChild
  while (last && (!laidOut(last) || aside(last))) last = last.previousElementSibling
  return (last ?? list).getBoundingClientRect().bottom
}

function spot(box: HTMLElement, list: HTMLElement, el: Element, seq: number): Anchor {
  const { top, bottom } = el.getBoundingClientRect()
  return { el, seq, top: top - box.getBoundingClientRect().top, at: box.scrollTop, under: endOf(list) - top, tall: bottom - top }
}

const aimOf = (a: Anchor, now: DOMRect): number => (a.top < 0 && a.tall > 0 ? (a.top * (now.bottom - now.top)) / a.tall : a.top)

function anchorIn(box: HTMLElement, list: HTMLElement): Anchor | null {
  const rows = list.querySelectorAll<HTMLElement>(":scope > [data-seq]")
  const top = box.getBoundingClientRect().top
  let lo = 0
  let hi = rows.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((rows[mid]?.getBoundingClientRect().bottom ?? 0) > top) hi = mid
    else lo = mid + 1
  }
  const el = rows[lo]
  const seq = Number(el?.dataset.seq)
  return el && Number.isSafeInteger(seq) ? spot(box, list, el, seq) : null
}

function docIn(box: HTMLElement, list: HTMLElement): Anchor | null {
  const el = list.querySelector(".thread-doc")
  if (!el) return null
  const view = box.getBoundingClientRect()
  const at = el.getBoundingClientRect()
  return at.bottom > view.top && at.top < view.bottom ? spot(box, list, el, Number.NaN) : null
}

function anchorRow(list: HTMLElement, seq: number): Element | null {
  let found: Element | null = null
  let best = -1
  for (const row of list.querySelectorAll<HTMLElement>(":scope > [data-seq]")) {
    const at = Number(row.dataset.seq)
    if (at <= seq && at > best) {
      best = at
      found = row
    }
  }
  return found
}

export function useStick(following = true, still = false) {
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const spacer = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const live = useRef(following)
  useLayoutEffect(() => {
    live.current = following
  }, [following])
  const anchor = useRef<Anchor | null>(null)
  const height = useRef(0)
  const held = useRef(false)
  const touched = useRef(false)
  const room = useRef(0)
  const width = useRef(0)
  const seen = useRef(Number.NaN)
  const wheeled = useRef(Number.NEGATIVE_INFINITY)
  const reserve = useRef(0)
  const placed = useRef<Anchor | null>(null)
  const holdUntil = useRef(0)
  const parked = useRef<Anchor | null>(null)
  const pad = useCallback(() => {
    const h = room.current + reserve.current
    if (spacer.current) spacer.current.style.height = h > 0 ? `${h}px` : ""
  }, [])
  const bottom = (box: HTMLElement): number => box.scrollHeight - box.clientHeight - reserve.current

  const correct = useCallback(
    (reflow: boolean) => {
      const box = scroller.current
      const list = content.current
      if (!box || !list) return
      height.current = list.offsetHeight
      if (reflow && stuck.current && room.current > 0) {
        room.current = 0
        pad()
      }
      const back = parked.current
      if (back && !laidOut(back.el)) parked.current = null
      else if (back && reflow) {
        const now = back.el.getBoundingClientRect()
        const to = box.scrollTop + now.top - box.getBoundingClientRect().top - aimOf(back, now)
        if (to > -0.5 && to < box.scrollHeight - box.clientHeight + 0.5) {
          parked.current = null
          stuck.current = false
          anchor.current = back
        }
      }
      const a = anchor.current
      if (stuck.current && (reflow || !(still && a))) {
        box.scrollTop = bottom(box)
        if (reflow) anchor.current = a && laidOut(a.el) ? spot(box, list, a.el, a.seq) : null
        return
      }
      if (!a) return
      if (still && a.el.isConnected && !laidOut(a.el)) {
        anchor.current = null
        box.scrollTop = stuck.current ? bottom(box) : a.at
        return
      }
      const el = a.el.isConnected ? a.el : anchorRow(list, a.seq)
      if (!el) {
        anchor.current = null
        if (stuck.current) box.scrollTop = bottom(box)
        return
      }
      const top = box.getBoundingClientRect().top
      if (still && Date.now() - wheeled.current < WHEEL_MS) {
        anchor.current = spot(box, list, el, a.seq)
        return
      }
      const holding = placed.current === a && Date.now() < holdUntil.current
      const clamped = still && box.scrollTop < a.at && box.scrollTop >= box.scrollHeight - box.clientHeight - 0.5
      const now = el.getBoundingClientRect()
      const at = now.top
      const aim = reflow ? aimOf(a, now) : clamped || holding ? a.top : a.top - (box.scrollTop - a.at)
      const shift = at - top - aim
      const lost = el === a.el ? a.under - (endOf(list) - at) : Number.POSITIVE_INFINITY
      const short = still && !reflow ? Math.min(box.scrollTop + shift - (box.scrollHeight - box.clientHeight), lost) : 0
      if (short > 0.5) {
        room.current += short
        pad()
      }
      if (Math.abs(shift) > 0.5) box.scrollTop += shift
      const gap = bottom(box) - box.scrollTop
      if (still && stuck.current && gap > 0.5 && gap < NEAR_BOTTOM) box.scrollTop = bottom(box)
      const landed = spot(box, list, el, a.seq)
      const reached = Math.abs(landed.top - aim) < 1
      if (reflow && !reached) parked.current ??= a
      anchor.current = reached ? { ...landed, top: aim } : landed
      if (holding) placed.current = anchor.current
    },
    [still, pad]
  )

  const settle = useCallback(() => {
    const box = scroller.current
    const list = content.current
    if (!box || !list) return
    const reflow = width.current > 0 && box.clientWidth !== width.current
    width.current = box.clientWidth
    if (!reflow && still && box.scrollTop < seen.current - 0.5 && gapIn(box) > 0.5) stuck.current = false
    const from = box.scrollTop
    correct(reflow)
    if (!reflow && box.scrollTop !== from) parked.current = null
    if (reflow || box.scrollTop !== from) seen.current = box.scrollTop
  }, [correct, still])

  const remember = useCallback(() => {
    const box = scroller.current
    const list = content.current
    if (!box || !list) return
    if (height.current && list.offsetHeight !== height.current) settle()
    if (reserve.current > 0 && Date.now() - wheeled.current >= WHEEL_MS) {
      reserve.current = 0
      pad()
    }
    const hidden = box.scrollHeight - box.scrollTop - box.clientHeight - reserve.current
    if (room.current > 0 && hidden > 0.5) {
      room.current = Math.max(0, room.current - hidden)
      pad()
    }
    const gap = gapIn(box)
    const up = box.scrollTop < seen.current - 0.5
    const down = box.scrollTop > seen.current + 0.5
    if (up || down) parked.current = null
    const near = !still || gap <= 0.5 ? gap < NEAR_BOTTOM : gap < NEAR_BOTTOM && !up && (stuck.current || down)
    stuck.current = live.current && !held.current && near
    const kept = placed.current && placed.current === anchor.current && Date.now() < holdUntil.current && anchor.current?.el.isConnected ? anchor.current : null
    const was = anchor.current
    const next = (still && touched.current ? docIn(box, list) : null) ?? (stuck.current ? null : (kept ?? anchorIn(box, list)))
    const sameSpot = next && was && next !== was && next.el === was.el && !up && !down && Math.abs(next.top - was.top) < 1
    anchor.current = sameSpot ? { ...next, top: was.top } : next
    height.current = list.offsetHeight
    seen.current = box.scrollTop
  }, [settle, still, pad])

  useLayoutEffect(() => {
    const box = scroller.current
    const list = content.current
    if (!box || !list) return
    width.current = box.clientWidth
    const watch = new ResizeObserver(settle)
    watch.observe(list)
    watch.observe(box)
    return () => watch.disconnect()
  }, [settle])

  useLayoutEffect(() => {
    const box = scroller.current
    if (!box || !still) return
    const touch = () => {
      placed.current = null
      if (touched.current) return
      touched.current = true
      remember()
    }
    const wheel = (e: WheelEvent) => {
      wheeled.current = Date.now()
      if (e.deltaY < 0 && reserve.current < box.clientHeight && box.scrollTop > 0.5 && gapIn(box) > -0.5) {
        reserve.current = box.clientHeight
        pad()
      } else if (e.deltaY > 0 && reserve.current > 0) {
        reserve.current = 0
        pad()
      }
      touch()
    }
    const kinds = ["pointerdown", "keydown", "touchstart"] as const
    for (const kind of kinds) box.addEventListener(kind, touch, { passive: true })
    box.addEventListener("wheel", wheel, { passive: true })
    return () => {
      for (const kind of kinds) box.removeEventListener(kind, touch)
      box.removeEventListener("wheel", wheel)
    }
  }, [remember, still, pad])

  useLayoutEffect(() => {
    const page = scroller.current?.ownerDocument
    if (!page) return
    const reader = () => {
      placed.current = null
    }
    const kinds = ["pointerdown", "keydown", "touchstart", "wheel"] as const
    for (const kind of kinds) page.addEventListener(kind, reader, { passive: true })
    return () => {
      for (const kind of kinds) page.removeEventListener(kind, reader)
    }
  }, [])

  const toBottom = useCallback(
    (smooth: boolean) => {
      const box = scroller.current
      if (!box) return
      stuck.current = true
      placed.current = null
      parked.current = null
      anchor.current = null
      if (room.current || reserve.current) {
        room.current = 0
        reserve.current = 0
        pad()
      }
      box.scrollTo({ top: box.scrollHeight, behavior: smooth && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" })
    },
    [pad]
  )

  const toOffset = useCallback((top: number) => {
    const box = scroller.current
    placed.current = null
    parked.current = null
    if (box) box.scrollTop = top
  }, [])

  const toRow = useCallback(
    (el: HTMLElement, offset: number) => {
      const box = scroller.current
      if (!box) return
      parked.current = null
      box.scrollTop = Math.round(box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - offset)
      remember()
      const seq = Number(el.dataset.seq)
      const list = content.current
      if (stuck.current || !list || !Number.isSafeInteger(seq)) return
      anchor.current = spot(box, list, el, seq)
      placed.current = anchor.current
      holdUntil.current = Date.now() + RESTORE_HOLD_MS
    },
    [remember]
  )

  const unstick = useCallback(() => {
    placed.current = null
    parked.current = null
    stuck.current = false
    anchor.current = null
  }, [])

  const hold = useCallback(
    (on: boolean) => {
      if (held.current === on) return
      held.current = on
      if (on) {
        const box = scroller.current
        const list = content.current
        stuck.current = false
        placed.current = null
        parked.current = null
        anchor.current = box && list ? anchorIn(box, list) : null
      } else remember()
    },
    [remember]
  )

  return { scroller, content, spacer, stuck, live, remember, settle, toBottom, toOffset, toRow, unstick, hold }
}
