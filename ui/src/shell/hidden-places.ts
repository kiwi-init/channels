import type { Where } from "~/model"
import { store } from "~/live/value"

const STORE_KEY = "mc.hidden-places"

function saved(): readonly string[] {
  try {
    const got: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]")
    return Array.isArray(got) ? got.filter((k): k is string => typeof k === "string") : []
  } catch {
    // Storage is off or the value is damaged: everything shows, which is the safe side.
    return []
  }
}

export const hiddenPlaces = store<readonly string[]>(saved())

function save(next: readonly string[]): void {
  hiddenPlaces.set(next)
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next))
  } catch {
    // Storage is off: it stays hidden until the app restarts, then shows again.
  }
}

export const hiddenKey = (code: string, where: Extract<Where, { kind: "room" | "dm" }>): string => `${code}/${where.kind === "room" ? `room:${where.room}` : `dm:${where.with}`}`

export const setHidden = (key: string, on: boolean): void => save(on ? [...new Set([...hiddenPlaces.get(), key])] : hiddenPlaces.get().filter((k) => k !== key))

export function comingBack(rows: readonly { key: string; news: boolean }[], hidden: readonly string[]): string[] {
  return rows.filter((r) => r.news && hidden.includes(r.key)).map((r) => r.key)
}
