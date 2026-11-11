import { useSyncExternalStore } from "react"

import { mod } from "~/kit/keys"

const KEY = "kiwi:blueprint"
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    const kept = localStorage.getItem(KEY)
    return kept === null ? import.meta.env.VITE_KIWI_BLUEPRINT === "1" : kept === "1"
  } catch {
    // Storage can be off (private windows, blocked site data): the guides start hidden and the shortcut still shows them.
    return false
  }
}

let on = read()

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

export const useBlueprint = (): boolean => useSyncExternalStore(subscribe, () => on)

export function toggleBlueprint(): void {
  on = !on
  try {
    localStorage.setItem(KEY, on ? "1" : "0")
  } catch {
    // Storage can be off: the choice lasts until the window reloads.
  }
  for (const l of listeners) l()
}

export const isBlueprintKey = (e: KeyboardEvent): boolean => e.code === "KeyB" && e.altKey && mod(e) && !e.shiftKey
