import type { UpOutcome } from "@kiwi/core/up-outcome.ts"
import { store } from "~/live/value"

const STORE_KEY = "mc.back-dismissed"

type Seat = Pick<UpOutcome, "channel" | "handle">

export function savedBackDismissed(): string | null {
  try {
    return localStorage.getItem(STORE_KEY)
  } catch {
    // Storage is off: the card shows, which is the safe side.
    return null
  }
}

export const backDismissed = store<string | null>(savedBackDismissed())

export const downSet = (down: readonly Seat[]): string => [...new Set(down.map((s) => `${s.channel}/${s.handle}`))].sort().join("\n")

export const backHidden = (down: readonly Seat[], dismissed: string | null): boolean => dismissed !== null && dismissed === downSet(down)

export function dismissBack(down: readonly Seat[]): void {
  const set = downSet(down)
  backDismissed.set(set)
  try {
    localStorage.setItem(STORE_KEY, set)
  } catch {
    // Storage is off: it stays hidden until the app restarts, then shows again.
  }
}
