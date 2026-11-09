import { useSyncExternalStore } from "react"

let slot: HTMLElement | null = null
const subs = new Set<() => void>()

export function setUpdatesSlot(el: HTMLElement | null): void {
  if (slot === el) return
  slot = el
  for (const f of subs) f()
}

export const useUpdatesSlot = (): HTMLElement | null =>
  useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => slot
  )
