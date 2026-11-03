import { rootOf } from "@kiwi/core/room-rules.ts"
import type { ChannelState } from "@kiwi/core/state.ts"
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

export function dmOther(state: Pick<ChannelState, "members">, seat: string, members: readonly { name: string }[]): string | undefined {
  const mine = rootOf(seat, state.members)
  return members.map((m) => rootOf(m.name, state.members)).find((root) => root !== mine)
}

export const dmInRoom = (channel: Pick<Channel, "people">, other: string): boolean => channel.people.some((p) => p.name === other && p.kind === "human")
