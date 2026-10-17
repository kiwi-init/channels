// Where each message sits (the channel's main conversation, a task's thread, or a direct thread)
// is folded by src/state.ts for every client (placeOf, places). This adds what only the web needs:
// what a message sent from a place carries, and which messages this browser has seen where.

import { useSyncExternalStore } from "react"

import type { SendOptions } from "@kiwi/core/client.ts"
import { chooseThread, type ChannelState, type Place } from "@kiwi/core/state.ts"

export { MAIN, dmPlace, placeFromKey, placeKey, type Place, type PlaceSummary } from "@kiwi/core/state.ts"

/**
 * What a message sent from a place carries so it lands there, chosen the way every client chooses it
 * (state.ts chooseThread): a task's thread, the direct thread with the other one, or main.
 */
export function sendFrom(state: Pick<ChannelState, "tasks" | "coordinator">, place: Place, me: string): Pick<SendOptions, "to" | "task" | "dm"> {
  const asked = place.kind === "task" ? { task: place.task } : place.kind === "dm" ? { dm: place.with[0] === me ? place.with[1] : place.with[0] } : { main: true }
  const c = chooseThread(state, me, asked)
  if (typeof c === "string") return {}
  return { ...(c.task !== undefined ? { task: c.task } : {}), ...(c.to ? { to: c.to } : {}), ...(c.dm ? { dm: true } : {}) }
}

// ---------- what's been read where ----------
//
// Per channel, the newest message this browser has seen in each place, kept in localStorage (best
// effort) and shared with every view through a tiny store, so marking a place read is an update to
// the outside world, not a render.

const seenKey = (room: string) => `mc.places-seen.${room}`
const seenCache = new Map<string, Record<string, number>>()
const seenListeners = new Set<() => void>()

function loadSeen(room: string): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(seenKey(room)) ?? "{}") as unknown
    return v && typeof v === "object" ? (v as Record<string, number>) : {}
  } catch {
    return {}
  }
}

/** What this browser has seen where in a channel (the same object until it changes). */
export function seenIn(room: string): Record<string, number> {
  let v = seenCache.get(room)
  if (!v) seenCache.set(room, (v = loadSeen(room)))
  return v
}

/** Raise what's been seen in some places of a channel; never lowers anything. */
export function markSeenIn(room: string, updates: Record<string, number>): void {
  const was = seenIn(room)
  if (Object.entries(updates).every(([k, v]) => (was[k] ?? 0) >= v)) return
  const next = { ...was }
  for (const [k, v] of Object.entries(updates)) next[k] = Math.max(next[k] ?? 0, v)
  seenCache.set(room, next)
  try {
    localStorage.setItem(seenKey(room), JSON.stringify(next))
  } catch {
    // A private window or full storage: this tab still remembers.
  }
  for (const l of seenListeners) l()
}

export function useSeen(room: string): Record<string, number> {
  return useSyncExternalStore(
    (l) => (seenListeners.add(l), () => void seenListeners.delete(l)),
    () => seenIn(room)
  )
}
