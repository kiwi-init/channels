import { useCallback, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react"

const KEY = "channels.panel.width"
const OLD_KEY = "mc.panel.width"
const START = 400
const MIN = 320
const MAX = 760
const MIN_CHAT = 420
const RAIL = 64
const SIDE = 248

export function panelRoom(w: number, windowWidth: number, sideHidden: boolean): number {
  const chat = windowWidth - RAIL - (sideHidden ? 0 : SIDE) - MIN_CHAT
  return Math.round(Math.max(MIN, Math.min(w, MAX, windowWidth * 0.6, chat)))
}

const onResize = (l: () => void) => (window.addEventListener("resize", l), () => window.removeEventListener("resize", l))

const useWindowWidth = (): number => useSyncExternalStore(onResize, () => window.innerWidth)

function stored(): number {
  try {
    const n = Number(localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY))
    return n || START
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

export function usePanelWidth(sideHidden: boolean) {
  const [wanted, setWanted] = useState(stored)
  const windowWidth = useWindowWidth()
  const width = panelRoom(wanted, windowWidth, sideHidden)

  const set = useCallback(
    (w: number) => {
      const next = panelRoom(w, window.innerWidth, sideHidden)
      setWanted(next)
      keep(next)
    },
    [sideHidden]
  )

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
