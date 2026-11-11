import { store } from "~/live/value"

const STORE_KEY = "mc.hidden-places"

function saved(key: string): readonly string[] {
  try {
    const got: unknown = JSON.parse(localStorage.getItem(key) ?? "[]")
    return Array.isArray(got) ? got.filter((k): k is string => typeof k === "string") : []
  } catch {
    // Storage is off or the value is damaged: everything shows, which is the safe side.
    return []
  }
}

export const hiddenPlaces = store<readonly string[]>(saved(STORE_KEY))

function save(list: typeof hiddenPlaces, key: string, next: readonly string[]): void {
  list.set(next)
  try {
    localStorage.setItem(key, JSON.stringify(next))
  } catch {
    // Storage is off: it stays hidden until the app restarts, then shows again.
  }
}

export const hiddenKey = (code: string, room: string): string => `${code}/room:${room}`

export function setHidden(key: string, on: boolean): void {
  save(hiddenPlaces, STORE_KEY, on ? [...new Set([...hiddenPlaces.get(), key])] : hiddenPlaces.get().filter((k) => k !== key))
}

export function comingBack(rows: readonly { key: string; mention: boolean }[], hidden: readonly string[]): string[] {
  return rows.filter((r) => hidden.includes(r.key) && r.mention).map((r) => r.key)
}
