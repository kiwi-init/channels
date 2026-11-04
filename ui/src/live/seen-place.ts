import { roomOfMessage, roomSeenKey } from "@kiwi/app/rooms.ts"
import { GENERAL_ROOM, type Message as Wire } from "@kiwi/core/protocol.ts"
import { rootOf } from "@kiwi/core/room-rules.ts"
import { dmPlace, placeKey, type ChannelState } from "@kiwi/core/state.ts"
import { dmOther } from "~/live/dm"
import type { Where } from "~/model"

export function seenKeyOf(state: Pick<ChannelState, "members">, where: Where, me: string): string {
  if (where.kind === "room") return roomSeenKey(where.room)
  if (where.kind === "dm") return placeKey(dmPlace(rootOf(me, state.members), where.with))
  if (where.kind === "theirs") return placeKey(dmPlace(...where.between))
  return placeKey({ kind: "task", task: where.task })
}

export function lastIn(messages: readonly Wire[], state: ChannelState, me: string, where: Where): number {
  const key = seenKeyOf(state, where, me)
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.kind === "event") continue
    const place = state.placeOf.get(m.seq) ?? { kind: "main" as const }
    if (where.kind === "dm" && place.kind === "main") {
      const room = state.rooms.get(roomOfMessage(state, m))
      const mine = rootOf(me, state.members)
      if (room?.dm && room.members?.some((x) => rootOf(x.name, state.members) === mine) && dmOther(state, me, room.members) === where.with) return m.seq
    }
    const at = place.kind === "main" ? roomSeenKey(state.roomOf.get(m.seq) ?? m.room ?? GENERAL_ROOM) : placeKey(place)
    if (at === key) return m.seq
  }
  return 0
}

function readKeyOf(state: ChannelState, m: Wire, me: string): string {
  const place = state.placeOf.get(m.seq) ?? { kind: "main" as const }
  if (place.kind !== "main") return placeKey(place)
  const id = roomOfMessage(state, m)
  const room = state.rooms.get(id)
  const mine = rootOf(me, state.members)
  const other = room?.dm && room.members?.some((x) => rootOf(x.name, state.members) === mine) ? dmOther(state, me, room.members) : undefined
  return other ? placeKey(dmPlace(mine, other)) : roomSeenKey(id)
}

export function seenByThread(messages: readonly Wire[], state: ChannelState, me: string, root: number, seen: Readonly<Record<string, number>>): Record<string, number> {
  const inThread = (m: Wire) => m.seq === root || state.threadOf.get(m.seq) === root
  const keys = new Set(messages.filter(inThread).map((m) => readKeyOf(state, m, me)))
  const mine = rootOf(me, state.members)
  const marks: Record<string, number> = {}
  for (const key of keys) {
    const from = seen[key] ?? 0
    let mark = from
    let next = from + 1
    for (const m of messages) {
      if (m.seq <= from) continue
      if (m.seq !== next) break
      next = m.seq + 1
      if (readKeyOf(state, m, me) !== key) continue
      if (inThread(m)) mark = m.seq
      else if (m.kind !== "event" && rootOf(m.from, state.members) !== mine) break
    }
    if (mark > from) marks[key] = mark
  }
  return marks
}
