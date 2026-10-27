import { useCallback, useState, type KeyboardEvent, type PointerEvent } from "react"

const KEY = "channels.panel.width"
const START = 400
const MIN = 320
const MAX = 760

const clamp = (w: number): number => Math.round(Math.min(Math.max(w, MIN), Math.min(MAX, window.innerWidth * 0.6)))

function stored(): number {
  try {
    const n = Number(localStorage.getItem(KEY))
    return n ? clamp(n) : START
  } catch {
    // Storage can be off (private windows, blocked site data): start at the default width.
    return START
  }
}

function keep(w: number): void {
  try {
    localStorage.setItem(KEY, String(w))
  } catch {
    // Storage can be off: the width just isn't remembered.
  }
}

export function usePanelWidth() {
  const [width, setWidth] = useState(stored)

  const set = useCallback((w: number) => {
    const next = clamp(w)
    setWidth(next)
    keep(next)
  }, [])

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const grip = e.currentTarget
      grip.setPointerCapture(e.pointerId)
      const from = e.clientX
      const start = width
      document.documentElement.dataset.resizing = "panel"
      const move = (ev: globalThis.PointerEvent) => set(start + from - ev.clientX)
      const up = () => {
        grip.removeEventListener("pointermove", move)
        grip.removeEventListener("pointerup", up)
        grip.removeEventListener("pointercancel", up)
        delete document.documentElement.dataset.resizing
      }
      grip.addEventListener("pointermove", move)
      grip.addEventListener("pointerup", up)
      grip.addEventListener("pointercancel", up)
    },
    [width, set]
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 64 : 16
      if (e.key === "ArrowLeft") set(width + step)
      else if (e.key === "ArrowRight") set(width - step)
      else if (e.key === "Home") set(MAX)
      else if (e.key === "End") set(MIN)
      else return
      e.preventDefault()
    },
    [width, set]
  )

  return { width, grip: { onPointerDown, onKeyDown, onDoubleClick: () => set(START) }, min: MIN, max: MAX }
}
