import { useSyncExternalStore } from "react"

import type { WakeSeat } from "@kiwi/core/wake.ts"
import type { KiwiBridge } from "@kiwi/secrets/secrets.ts"

type Wake = Pick<KiwiBridge, "wakeSeats" | "setWake">

function wakeBridge(): Wake | null {
  try {
    const k = (window as unknown as { kiwi?: Partial<Wake> }).kiwi
    return k && typeof k.wakeSeats === "function" && typeof k.setWake === "function" ? (k as Wake) : null
  } catch {
    // No window (a test or a worker): no seats on this computer to wake.
    return null
  }
}

let seats: readonly WakeSeat[] = []
let asking = false
const listeners = new Set<() => void>()

function tell(next: readonly WakeSeat[]): void {
  seats = next
  for (const l of listeners) l()
}

function load(): void {
  const b = wakeBridge()
  if (!b || asking) return
  asking = true
  void b
    .wakeSeats()
    .then(tell, () => {})
    .finally(() => (asking = false))
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    load()
    window.addEventListener("focus", load)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) window.removeEventListener("focus", load)
  }
}

const read = (): readonly WakeSeat[] => seats

export function useWakeSeat(room: string | undefined, agent: string): WakeSeat | null {
  const all = useSyncExternalStore(subscribe, read, read)
  return (room && all.find((s) => s.room === room && s.agent === agent)) || null
}

export async function setWake(seat: WakeSeat, to: "on" | "off"): Promise<void> {
  const b = wakeBridge()
  if (!b) throw new Error("Only the desktop app can change how this computer wakes its agents")
  tell(await b.setWake(seat.room, seat.agent, to))
}
