import { useMemo, useSyncExternalStore } from "react"

import type { SharedSeat, SharedWith } from "@kiwi/core/shared-seats.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"
import { paced } from "~/live/paced"

let seats: readonly SharedSeat[] = []
const listeners = new Set<() => void>()

function tell(next: readonly SharedSeat[]): void {
  seats = next
  for (const l of listeners) l()
}

const ask = (): Promise<SharedSeat[]> => {
  const b = bridge()
  return b && typeof b.sharedSeats === "function" ? b.sharedSeats() : Promise.resolve([])
}

const load = paced(ask, tell)

function subscribe(l: () => void): () => void {
  listeners.add(l)
  if (listeners.size === 1) {
    load()
    window.addEventListener("focus", load)
  }
  return () => {
    listeners.delete(l)
    if (!listeners.size) window.removeEventListener("focus", load)
  }
}

const read = (): readonly SharedSeat[] => seats

export function useSharedHere(room: string): ReadonlyMap<string, readonly SharedWith[]> {
  const all = useSyncExternalStore(subscribe, read, read)
  return useMemo(() => new Map(all.filter((s) => s.room === room).map((s) => [s.agent, s.with])), [all, room])
}
