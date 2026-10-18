import type { RoomsSetting } from "@kiwi/core/client.ts"
import type { JoinRequest, Member } from "@kiwi/core/membership.ts"
import type { Message } from "@kiwi/core/protocol.ts"
import type { FoldBase, GuardFloor } from "@kiwi/core/state.ts"
import { planReload } from "../history-plan"
import type { Marks } from "../receipts"

export interface Warm {
  messages: Message[]
  roster: Member[]
  requests: JoinRequest[]
  marks: Marks
  guardFloor: GuardFloor | null
  roomsFloor: RoomsSetting | null
  base: FoldBase | null
}

const warm = new Map<string, Warm>()

export const warmOf = (code: string): Warm | undefined => warm.get(code)

export function keepWarm(code: string, w: Warm): void {
  warm.set(code, w)
}

export function dropWarm(code: string): void {
  warm.delete(code)
}

/** Where to follow from when this session already holds the window: no cache read, no second verify. */
export function heldWindow(w: Warm | undefined, head: number, limit: number): { since: number; firstSeq: number } | null {
  if (!w?.messages.length) return null
  const plan = planReload(
    w.messages.map((m) => m.seq),
    head,
    limit
  )
  return plan.keep.length ? { since: plan.since, firstSeq: plan.keep[0]! } : null
}
