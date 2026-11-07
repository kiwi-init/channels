import { useEffect } from "react"

const MINUTE = 60_000
const INPUT = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const

export function untilAfk(lastInput: number, now: number, wait: number): number {
  return Math.max(0, lastInput + wait - now)
}

export function useAfkWait(minutes: number, paused: boolean, away: () => void): void {
  useEffect(() => {
    if (!minutes || paused) return
    const wait = minutes * MINUTE
    let last = performance.now()
    let timer = 0
    const check = (): void => {
      const left = untilAfk(last, performance.now(), wait)
      if (left > 0) timer = window.setTimeout(check, left)
      else if (document.querySelector("dialog[open]")) timer = window.setTimeout(check, wait)
      else away()
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
  }, [minutes, paused, away])
}
