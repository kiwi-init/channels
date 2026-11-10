import { useMemo, useSyncExternalStore } from "react"

import type { WakeSeat } from "@kiwi/core/wake.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"
import { t } from "~/i18n/i18n"
import { paced } from "~/live/paced"

let seats: readonly WakeSeat[] = []
const listeners = new Set<() => void>()

function tell(next: readonly WakeSeat[]): void {
  seats = next
  for (const l of listeners) l()
}

const load = paced(() => bridge()?.wakeSeats() ?? Promise.reject(new Error(t("live.wakes.desktop.only"))), tell)

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

export function useOwnAgents(): number {
  return useSyncExternalStore(subscribe, read, read).length
}

export async function setWake(room: string, agent: string, on: boolean): Promise<void> {
  const b = bridge()
  if (!b) throw new Error(t("live.wakes.desktop.only"))
  if (!seats.some((s) => s.room === room && s.agent === agent)) throw new Error(t("live.wakes.not.here", { agent }))
  tell(await b.setWake(room, agent, on ? "on" : "off"))
}
