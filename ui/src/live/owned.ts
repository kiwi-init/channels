import { useSyncExternalStore } from "react"

const KEY = "kiwi:owned"

export type Owned = Readonly<Record<string, boolean>>

export function ownedOf(raw: string | null): Owned {
  try {
    const v: unknown = JSON.parse(raw ?? "{}")
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {}
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, boolean] => typeof e[1] === "boolean"))
  } catch {
    // A store that doesn't parse says nothing about any channel: every tile reads as unknown.
    return {}
  }
}

let owned: Owned | null = null
const listeners = new Set<() => void>()

function read(): Owned {
  if (owned) return owned
  try {
    owned = ownedOf(localStorage.getItem(KEY))
  } catch {
    // Storage can be off (private windows, blocked site data): nothing is known until a channel loads.
    owned = {}
  }
  return owned
}

export function noteOwned(code: string, own: boolean): void {
  if (read()[code] === own) return
  owned = { ...read(), [code]: own }
  try {
    localStorage.setItem(KEY, JSON.stringify(owned))
  } catch {
    // Storage can be off: the answer still holds for this run of the app.
  }
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

export const useOwned = (): Owned => useSyncExternalStore(subscribe, read)
