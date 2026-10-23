import { useCallback, useSyncExternalStore } from "react"

let latest = Date.now()
const clockTimer = setInterval(() => {
  latest = Date.now()
}, 1000) as unknown as { unref?: () => void }
clockTimer.unref?.()

export function clockNow(): number {
  return latest
}

export const tickOf = (at: number, intervalMs: number): number => at - (at % intervalMs)

interface Tick {
  listeners: Set<() => void>
  timer: ReturnType<typeof setTimeout> | undefined
}

const ticks = new Map<number, Tick>()

function arm(intervalMs: number, tick: Tick): void {
  tick.timer = setTimeout(
    () => {
      for (const l of tick.listeners) l()
      arm(intervalMs, tick)
    },
    intervalMs - (Date.now() % intervalMs) + 5
  )
}

export function subscribeTick(intervalMs: number, onChange: () => void): () => void {
  let tick = ticks.get(intervalMs)
  if (!tick) {
    tick = { listeners: new Set(), timer: undefined }
    ticks.set(intervalMs, tick)
    arm(intervalMs, tick)
  }
  tick.listeners.add(onChange)
  const held = tick
  return () => {
    held.listeners.delete(onChange)
    if (held.listeners.size > 0) return
    clearTimeout(held.timer)
    ticks.delete(intervalMs)
  }
}

export const tickTimers = (): number => ticks.size

export function useClock(intervalMs: number): number {
  const subscribe = useCallback((onChange: () => void) => subscribeTick(intervalMs, onChange), [intervalMs])
  const snapshot = useCallback(() => tickOf(Date.now(), intervalMs), [intervalMs])
  return useSyncExternalStore(subscribe, snapshot)
}
