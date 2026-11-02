import type { Where } from "~/model"
import { store } from "~/live/value"

const STORE_KEY = "mc.hidden-places"
const KEPT_KEY = "mc.kept-hidden-places"

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
export const keptHidden = store<readonly string[]>(saved(KEPT_KEY))

function save(list: typeof hiddenPlaces, key: string, next: readonly string[]): void {
  list.set(next)
  try {
    localStorage.setItem(key, JSON.stringify(next))
  } catch {
    // Storage is off: it stays hidden until the app restarts, then shows again.
  }
}

export const hiddenKey = (code: string, where: Extract<Where, { kind: "room" | "dm" }>): string => `${code}/${where.kind === "room" ? `room:${where.room}` : `dm:${where.with}`}`

export function setHidden(key: string, on: boolean, keep = false): void {
  save(hiddenPlaces, STORE_KEY, on ? [...new Set([...hiddenPlaces.get(), key])] : hiddenPlaces.get().filter((k) => k !== key))
  save(keptHidden, KEPT_KEY, on && keep ? [...new Set([...keptHidden.get(), key])] : keptHidden.get().filter((k) => k !== key))
}

export function comingBack(rows: readonly { key: string; news: boolean; mention?: boolean }[], hidden: readonly string[], kept: readonly string[] = []): string[] {
  return rows.filter((r) => hidden.includes(r.key) && (kept.includes(r.key) ? r.mention : r.news)).map((r) => r.key)
}
