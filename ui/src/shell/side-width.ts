import { useCallback, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react"

const KEY = "channels.side.width"
const START = 18
const MIN = 14
const MAX = 28
const GRID = 8
const WORK = 480

const listeners = new Set<() => void>()
let rem = START

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

export const rootPx = (): number => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

export function sideRem(px: number, root: number): number {
  const snapped = Math.round(px / GRID) * GRID
  const least = Math.ceil((MIN * root) / GRID) * GRID
  const most = Math.floor((MAX * root) / GRID) * GRID
  return Math.max(least, Math.min(snapped, most)) / root
}

export function sidePx(wanted: number, root: number, windowWidth: number): number {
  const snap = (px: number) => Math.round(px / GRID) * GRID
  const room = Math.floor((windowWidth - WORK) / 2 / GRID) * GRID
  return Math.min(snap(wanted * root), Math.max(snap(START * root), room))
}

function stored(): number {
  try {
    const n = Number(localStorage.getItem(KEY))
    return n >= MIN && n <= MAX ? n : START
  } catch {
    // Storage can be off (private windows, blocked site data): start at the default width.
    return START
  }
}

function keep(next: number): void {
  try {
    if (next === START) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, String(next))
  } catch {
    // Storage can be off: the width just isn't remembered.
  }
}

function apply(next: number): void {
  rem = next
  const root = document.documentElement
  if (next === START) root.style.removeProperty("--side-want")
  else root.style.setProperty("--side-want", `${next}rem`)
  for (const l of listeners) l()
}

export function bootSideWidth(): void {
  apply(stored())
}

function set(px: number): void {
  const root = rootPx()
  const next = sideRem(Math.min(px, sidePx(MAX, root, window.innerWidth)), root)
  if (next === rem) return
  apply(next)
  keep(next)
}

function reset(): void {
  apply(START)
  keep(START)
}

export const useSideRem = (): number => useSyncExternalStore(subscribe, () => rem)

export function useSideWidth() {
  const now = useSideRem()
  const root = rootPx()

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const grip = e.currentTarget
    grip.setPointerCapture(e.pointerId)
    const off = e.clientX - grip.getBoundingClientRect().left - grip.offsetWidth / 2
    document.documentElement.dataset.resizing = "side"
    const move = (ev: globalThis.PointerEvent) => set(ev.clientX - off)
    const up = () => {
      grip.removeEventListener("pointermove", move)
      grip.removeEventListener("pointerup", up)
      grip.removeEventListener("pointercancel", up)
      delete document.documentElement.dataset.resizing
    }
    grip.addEventListener("pointermove", move)
    grip.addEventListener("pointerup", up)
    grip.addEventListener("pointercancel", up)
  }, [])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? GRID * 4 : GRID
    const width = rem * rootPx()
    if (e.key === "ArrowRight") set(width + step)
    else if (e.key === "ArrowLeft") set(width - step)
    else if (e.key === "Home") set(MIN * rootPx())
    else if (e.key === "End") set(MAX * rootPx())
    else return
    e.preventDefault()
  }, [])

  return { width: Math.round(now * root), grip: { onPointerDown, onKeyDown, onDoubleClick: reset }, min: Math.round(MIN * root), max: Math.round(MAX * root) }
}
