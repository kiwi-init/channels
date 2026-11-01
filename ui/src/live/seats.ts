import { useEffect, useSyncExternalStore } from "react"

import type { PlacedSeat } from "@kiwi/core/terminals.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"
import { whileShown } from "~/live/shown"
import { store } from "~/live/value"
import type { Person } from "~/model"

const seats = store<readonly PlacedSeat[]>([])

export function seated(people: Person[], placed: readonly PlacedSeat[], room: string): Person[] {
  return people.map((p) => {
    const seat = p.kind === "agent" ? placed.find((s) => s.room === room && s.agent === p.name) : undefined
    return seat ? { ...p, seat: seat.place, ...(seat.place !== "rex" && seat.attach ? { attach: seat.attach } : {}) } : p
  })
}

export const seatOf = (room: string, agent: string): PlacedSeat | undefined => seats.get().find((s) => s.room === room && s.agent === agent)

export function useSeats(): readonly PlacedSeat[] {
  useEffect(() => {
    const b = bridge()
    if (!b) return
    let live = true
    const load = () =>
      void b.seatPlaces().then(
        (list) => live && seats.set(list),
        () => {}
      )
    load()
    const stop = whileShown(load, 15_000)
    window.addEventListener("focus", load)
    return () => {
      live = false
      stop()
      window.removeEventListener("focus", load)
    }
  }, [])
  return useSyncExternalStore(seats.subscribe, seats.get)
}
