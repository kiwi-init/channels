import { useEffect, useState } from "react"

import { PLACE_NAMES, type PlaceKind, type PlacedSeat, type ShowRefusal, type ShowResult } from "@kiwi/core/terminals.ts"
import { bridge, type KiwiBridge } from "./secrets"

export type { PlacedSeat, ShowResult }

export function useSeatPlaces(): PlacedSeat[] {
  const [seats, setSeats] = useState<PlacedSeat[]>([])
  useEffect(() => {
    const b = bridge()
    if (!b?.seatPlaces) return
    let live = true
    const load = () => {
      void b.seatPlaces().then(
        (list) => {
          if (live) setSeats(list)
        },
        () => {}
      )
    }
    load()
    const every = setInterval(load, 15_000)
    const wake = () => load()
    window.addEventListener("focus", wake)
    document.addEventListener("visibilitychange", wake)
    return () => {
      live = false
      clearInterval(every)
      window.removeEventListener("focus", wake)
      document.removeEventListener("visibilitychange", wake)
    }
  }, [])
  return seats
}

export function showSeat(seat: PlacedSeat): Promise<ShowResult> {
  const b = bridge()
  return b?.showSeat ? b.showSeat(seat) : Promise.resolve({ ok: false, why: "failed" })
}

export function showLabel(place: PlaceKind): string {
  return `Show in ${PLACE_NAMES[place]}`
}

function rexNote(why: ShowRefusal): string {
  switch (why) {
    case "remote-control":
      return "Turn on Remote Control in Rex's settings to open it."
    case "no-server":
      return "Rex isn't running on this computer."
    case "no-app":
      return "Open the Rex app to show it there."
    case "no-rex":
      return "Rex isn't installed on this computer."
    case "failed":
      return "Rex didn't open that seat."
  }
}

const NOTES: Record<PlacedSeat["place"], (why: ShowRefusal) => string> = { rex: rexNote }

export function showNote(place: PlacedSeat["place"], result: ShowResult): string | null {
  return result.ok ? null : NOTES[place](result.why)
}

type Terminals = Pick<KiwiBridge, "terminals" | "terminalHelpers" | "terminalPrefer" | "setLaunches">

export function terminalsBridge(): Terminals | null {
  try {
    const k = (window as unknown as { kiwi?: Partial<Terminals> }).kiwi
    return k && typeof k.terminals === "function" && typeof k.terminalHelpers === "function" && typeof k.terminalPrefer === "function" && typeof k.setLaunches === "function" ? (k as Terminals) : null
  } catch {
    // No window (a test or a worker): no terminals to set.
    return null
  }
}

export function useLaunchesHere(): boolean {
  const [on, setOn] = useState(true)
  useEffect(() => {
    const b = terminalsBridge()
    if (!b) return
    let live = true
    void b.terminals().then(
      (s) => live && setOn(s?.launch !== "off"),
      () => {}
    )
    return () => {
      live = false
    }
  }, [])
  return on
}
