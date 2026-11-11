import { useCallback, useLayoutEffect, useRef } from "react"

const NEAR_BOTTOM = 48

const WHEEL_MS = 400

interface Anchor {
  el: Element
  seq: number
  top: number
  at: number
}

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
  return el && Number.isSafeInteger(seq) ? { el, seq, top: el.getBoundingClientRect().top - top, at: box.scrollTop } : null
}

const gapIn = (box: HTMLElement): number => box.scrollHeight - box.scrollTop - box.clientHeight

const laidOut = (el: Element): boolean => el.isConnected && el.getClientRects().length > 0

function docIn(box: HTMLElement, list: HTMLElement): Anchor | null {
  const el = list.querySelector(".thread-doc")
  if (!el) return null
  const view = box.getBoundingClientRect()
  const at = el.getBoundingClientRect()
  return at.bottom > view.top && at.top < view.bottom ? { el, seq: Number.NaN, top: at.top - view.top, at: box.scrollTop } : null
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
  const seen = useRef(Number.NaN)
  const wheeled = useRef(Number.NEGATIVE_INFINITY)
  const reserve = useRef(0)
  const placed = useRef<Anchor | null>(null)
  const pad = useCallback(() => {
    const h = room.current + reserve.current
    if (spacer.current) spacer.current.style.height = h > 0 ? `${h}px` : ""
  }, [])
  const bottom = (box: HTMLElement): number => box.scrollHeight - box.clientHeight - reserve.current

  const correct = useCallback(() => {
    const box = scroller.current
    const list = content.current
    if (!box || !list) return
    height.current = list.offsetHeight
    if (stuck.current && !(still && anchor.current)) {
      box.scrollTop = bottom(box)
      return
    }
    const a = anchor.current
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
      anchor.current = { el, seq: a.seq, top: el.getBoundingClientRect().top - top, at: box.scrollTop }
      return
    }
    const ours = placed.current === a
    const clamped = still && box.scrollTop < a.at && box.scrollTop >= box.scrollHeight - box.clientHeight - 0.5
    const aim = clamped || ours ? a.top : a.top - (box.scrollTop - a.at)
    const shift = el.getBoundingClientRect().top - top - aim
    const short = still ? box.scrollTop + shift - (box.scrollHeight - box.clientHeight) : 0
    if (short > 0.5) {
      room.current += short
      pad()
    }
    if (Math.abs(shift) > 0.5) box.scrollTop += shift
    const gap = bottom(box) - box.scrollTop
    if (still && stuck.current && gap > 0.5 && gap < NEAR_BOTTOM) box.scrollTop = bottom(box)
    const landed = el.getBoundingClientRect().top - top
    anchor.current = { el, seq: a.seq, top: Math.abs(landed - aim) < 1 ? aim : landed, at: box.scrollTop }
    placed.current = anchor.current
  }, [still, pad])

  const settle = useCallback(() => {
    const box = scroller.current
    const list = content.current
    if (!box || !list) return
    if (still && box.scrollTop < seen.current - 0.5 && gapIn(box) > 0.5) stuck.current = false
    const from = box.scrollTop
    correct()
    if (box.scrollTop !== from) seen.current = box.scrollTop
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
    const near = !still || gap <= 0.5 ? gap < NEAR_BOTTOM : gap < NEAR_BOTTOM && !up && (stuck.current || down)
    stuck.current = live.current && !held.current && near
    const kept = placed.current && placed.current === anchor.current && placed.current.el.isConnected && Math.abs(box.scrollTop - placed.current.at) < 0.5 ? placed.current : null
    anchor.current = (still && touched.current ? docIn(box, list) : null) ?? (stuck.current ? null : (kept ?? anchorIn(box, list)))
    placed.current = null
    height.current = list.offsetHeight
    seen.current = box.scrollTop
  }, [settle, still, pad])

  useLayoutEffect(() => {
    const box = scroller.current
    const list = content.current
    if (!box || !list) return
    const watch = new ResizeObserver(settle)
    watch.observe(list)
    watch.observe(box)
    return () => watch.disconnect()
  }, [settle])

  useLayoutEffect(() => {
    const box = scroller.current
    if (!box || !still) return
    const touch = () => {
      if (touched.current) return
      touched.current = true
      remember()
    }
    const wheel = (e: WheelEvent) => {
      wheeled.current = Date.now()
      if (e.deltaY < 0 && reserve.current < box.clientHeight) {
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

  const toBottom = useCallback(
    (smooth: boolean) => {
      const box = scroller.current
      if (!box) return
      stuck.current = true
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
    if (box) box.scrollTop = top
  }, [])

  const toRow = useCallback(
    (el: HTMLElement, offset: number) => {
      const box = scroller.current
      if (!box) return
      box.scrollTop = Math.round(box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - offset)
      remember()
      const seq = Number(el.dataset.seq)
      if (stuck.current || !Number.isSafeInteger(seq)) return
      anchor.current = { el, seq, top: el.getBoundingClientRect().top - box.getBoundingClientRect().top, at: box.scrollTop }
      placed.current = anchor.current
    },
    [remember]
  )

  const unstick = useCallback(() => {
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
        anchor.current = box && list ? anchorIn(box, list) : null
      } else remember()
    },
    [remember]
  )

  return { scroller, content, spacer, stuck, live, remember, settle, toBottom, toOffset, toRow, unstick, hold }
}
