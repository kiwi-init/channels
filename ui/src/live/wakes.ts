import { useMemo, useSyncExternalStore } from "react"

import type { WakeSeat } from "@kiwi/core/wake.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"

let seats: readonly WakeSeat[] = []
let asking = false
const listeners = new Set<() => void>()

function tell(next: readonly WakeSeat[]): void {
  seats = next
  for (const l of listeners) l()
}

function load(): void {
  const b = bridge()
  if (!b || asking) return
  asking = true
  void b
    .wakeSeats()
    .then(tell, () => {})
    .finally(() => (asking = false))
}

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

const read = (): readonly WakeSeat[] => seats

export function useWakes(room: string): ReadonlyMap<string, boolean> {
  const all = useSyncExternalStore(subscribe, read, read)
  return useMemo(() => new Map(all.filter((s) => s.room === room).map((s) => [s.agent, s.wake === "on"])), [all, room])
}

export async function setWake(room: string, agent: string, on: boolean): Promise<void> {
  const b = bridge()
  if (!b) throw new Error("Only the desktop app wakes agents on this computer")
  if (!seats.some((s) => s.room === room && s.agent === agent)) throw new Error(`${agent} doesn't run on this computer, so it can't wake it`)
  tell(await b.setWake(room, agent, on ? "on" : "off"))
}
