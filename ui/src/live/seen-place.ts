import { roomSeenKey } from "@kiwi/app/rooms.ts"
import { GENERAL_ROOM, type Message as Wire } from "@kiwi/core/protocol.ts"
import { dmPlace, placeKey, type ChannelState } from "@kiwi/core/state.ts"
import type { Where } from "~/model"

export function seenKeyOf(where: Where, me: string): string {
  if (where.kind === "room") return roomSeenKey(where.room)
  if (where.kind === "dm") return placeKey(dmPlace(me, where.with))
  if (where.kind === "theirs") return placeKey(dmPlace(...where.between))
  return placeKey({ kind: "task", task: where.task })
}

export function lastIn(messages: readonly Wire[], state: ChannelState, me: string, where: Where): number {
  const key = seenKeyOf(where, me)
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.kind === "event") continue
    const place = state.placeOf.get(m.seq) ?? { kind: "main" as const }
    const at = place.kind === "main" ? roomSeenKey(state.roomOf.get(m.seq) ?? m.room ?? GENERAL_ROOM) : placeKey(place)
    if (at === key) return m.seq
  }
  return 0
}
