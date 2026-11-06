import { roomOfMessage } from "@kiwi/app/rooms.ts"
import type { Message } from "@kiwi/core/protocol.ts"
import { rootOf } from "@kiwi/core/room-rules.ts"
import { docThread } from "@kiwi/core/doc/threads.ts"
import { dmPlace, MAIN, type ChannelState } from "@kiwi/core/state.ts"
import type { Channel } from "~/model"

export function dmRoomOf(state: Pick<ChannelState, "rooms" | "members">, seat: string, other: string): string | undefined {
  const mine = rootOf(seat, state.members)
  for (const r of state.rooms.values()) {
    if (!r.dm || !r.members) continue
    const people = new Set(r.members.map((m) => rootOf(m.name, state.members)))
    if (people.size === 2 && people.has(mine) && people.has(other)) return r.id
  }
  return undefined
}

export function dmDocOf(state: Pick<ChannelState, "rooms" | "members">, seat: string, other: string): string | undefined {
  const id = dmRoomOf(state, seat, other)
  const [a, b, ...more] = (id ? state.rooms.get(id)?.members : undefined) ?? []
  return a && b && !more.length ? docThread(dmPlace(a.name, b.name)) : undefined
}

export function dmOther(state: Pick<ChannelState, "members">, seat: string, members: readonly { name: string }[]): string | undefined {
  const mine = rootOf(seat, state.members)
  return members.map((m) => rootOf(m.name, state.members)).find((root) => root !== mine)
}

export function dmRoomWith(state: Pick<ChannelState, "placeOf" | "roomOf" | "rooms" | "members">, seat: string, m: Pick<Message, "seq" | "room">): string | undefined {
  if ((state.placeOf.get(m.seq) ?? MAIN).kind !== "main") return undefined
  const room = state.rooms.get(roomOfMessage(state, m))
  return room?.dm && room.members ? dmOther(state, seat, room.members) : undefined
}

export const dmInRoom = (channel: Pick<Channel, "people">, other: string): boolean => channel.people.some((p) => p.name === other && p.kind === "human")

export function dmsOnce(): (other: string, make: () => Promise<string | undefined>) => Promise<string | undefined> {
  const making = new Map<string, Promise<string | undefined>>()
  return (other, make) => {
    const had = making.get(other)
    if (had) return had
    const next = make()
    making.set(other, next)
    void next.then(
      (room) => {
        if (room === undefined) making.delete(other)
      },
      () => making.delete(other)
    )
    return next
  }
}
