import { useEffect, useState } from "react"

import type { RexSeatView, RexShowResult } from "../../../desktop/src/bridge.ts"
import { bridge } from "./secrets"

export type { RexSeatView, RexShowResult }

export function useRexSeats(): RexSeatView[] {
  const [seats, setSeats] = useState<RexSeatView[]>([])
  useEffect(() => {
    const b = bridge()
    if (!b?.rexSeats) return
    let live = true
    void b.rexSeats().then(
      (list) => {
        if (live) setSeats(list)
      },
      () => {}
    )
    return () => {
      live = false
    }
  }, [])
  return seats
}

export function showInRex(seat: RexSeatView): Promise<RexShowResult> {
  const b = bridge()
  return b?.rexShow ? b.rexShow(seat) : Promise.resolve({ ok: false, why: "failed" })
}

export function rexNote(result: RexShowResult): string | null {
  if (result.ok) return null
  switch (result.why) {
    case "remote-control":
      return "Turn on Remote Control in Rex's settings to open it."
    case "no-server":
      return "Rex isn't running on this computer."
    case "no-rex":
      return "Rex isn't installed on this computer."
    case "failed":
      return "Rex didn't open that seat."
  }
}
