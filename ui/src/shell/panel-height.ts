import { useCallback, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react"

export const PORTRAIT = "(orientation: portrait) and (min-width: 761px)"

const KEY = "channels.panel.height"
const SHARE = 0.45
const MIN = 240
const MIN_MAIN = 240
const TOP = 52

export function dockRoom(h: number, windowHeight: number): number {
  return Math.round(Math.max(MIN, Math.min(h, windowHeight - TOP - MIN_MAIN)))
}

const onResize = (l: () => void) => (window.addEventListener("resize", l), () => window.removeEventListener("resize", l))

const useWindowHeight = (): number => useSyncExternalStore(onResize, () => window.innerHeight)

export const usePortrait = (): boolean => useSyncExternalStore(onResize, () => matchMedia(PORTRAIT).matches)

function stored(): number {
  try {
    return Number(localStorage.getItem(KEY)) || Math.round(window.innerHeight * SHARE)
  } catch {
    // Storage can be off (private windows, blocked site data): start at the default share of the window.
    return Math.round(window.innerHeight * SHARE)
  }
}

function keep(h: number): void {
  try {
    localStorage.setItem(KEY, String(h))
  } catch {
    // Storage can be off: the height just isn't remembered.
  }
}

export function usePanelHeight() {
  const [wanted, setWanted] = useState(stored)
  const windowHeight = useWindowHeight()
  const height = dockRoom(wanted, windowHeight)

  const set = useCallback((h: number) => {
    const next = dockRoom(h, window.innerHeight)
    setWanted(next)
    keep(next)
  }, [])

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const grip = e.currentTarget
      grip.setPointerCapture(e.pointerId)
      const from = e.clientY
      const start = height
      document.documentElement.dataset.resizing = "dock"
      const move = (ev: globalThis.PointerEvent) => set(start + from - ev.clientY)
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
    [height, set]
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 64 : 16
      if (e.key === "ArrowUp") set(height + step)
      else if (e.key === "ArrowDown") set(height - step)
      else if (e.key === "Home") set(window.innerHeight)
      else if (e.key === "End") set(MIN)
      else return
      e.preventDefault()
    },
    [height, set]
  )

  const max = Math.max(MIN, windowHeight - TOP - MIN_MAIN)
  return { height, grip: { onPointerDown, onKeyDown, onDoubleClick: () => set(Math.round(window.innerHeight * SHARE)) }, min: MIN, max }
}
