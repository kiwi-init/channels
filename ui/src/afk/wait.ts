import { useEffect, useSyncExternalStore } from "react"

export const AFK_MINUTES = [0, 1, 3, 5, 10] as const
export const DEFAULT_AFK = 3

const MINUTE = 60_000
const INPUT = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const

export function afkMinutes(raw: unknown): number {
  return typeof raw === "number" && (AFK_MINUTES as readonly number[]).includes(raw) ? raw : DEFAULT_AFK
}

export function untilAfk(lastInput: number, now: number, wait: number): number {
  return Math.max(0, lastInput + wait - now)
}

const listeners = new Set<() => void>()
let shown = false

function setShown(next: boolean): void {
  if (shown === next) return
  shown = next
  for (const l of listeners) l()
}

export const showAfk = (): void => setShown(true)
export const hideAfk = (): void => setShown(false)

export function useAfkShown(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => shown
  )
}

export function useAfkWait(minutes: number, paused: boolean): void {
  useEffect(() => {
    if (!minutes || paused) return
    const wait = minutes * MINUTE
    let last = performance.now()
    let timer = 0
    const check = (): void => {
      const left = untilAfk(last, performance.now(), wait)
      if (left > 0) timer = window.setTimeout(check, left)
      else if (document.querySelector("dialog[open]")) timer = window.setTimeout(check, wait)
      else showAfk()
    }
    const touch = (): void => {
      last = performance.now()
    }
    timer = window.setTimeout(check, wait)
    for (const type of INPUT) window.addEventListener(type, touch, { capture: true, passive: true })
    return () => {
      window.clearTimeout(timer)
      for (const type of INPUT) window.removeEventListener(type, touch, { capture: true })
    }
  }, [minutes, paused])
}
