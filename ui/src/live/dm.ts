import { PRIVATE_DM_OPS } from "@kiwi/core/protocol.ts"
import { roomReadiness, rootOf } from "@kiwi/core/room-rules.ts"
import type { ChannelState } from "@kiwi/core/state.ts"
import type { Channel } from "~/model"
import { seatRoot, shown } from "~/names"

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

export function dmBlocker(channel: Pick<Channel, "people" | "you">, other: string): string | null {
  const mine = seatRoot(channel, channel.you)
  const them = channel.people.find((p) => p.name === other)
  if (!them || them.kind !== "human") return null
  for (const p of channel.people) {
    const root = seatRoot(channel, p.name)
    if (p.left || p.kind !== "human" || (root !== mine && root !== other)) continue
    if (roomReadiness(p.ops, p.opsLive ? [p.opsLive] : [], PRIVATE_DM_OPS) !== "ready") return root === mine ? (p.you ? "your app" : "your other device") : `${shown(them)}'s app`
  }
  return null
}

export const sealable = (channel: Pick<Channel, "people" | "you">, other: string): boolean => channel.people.some((p) => p.name === other && p.kind === "human") && dmBlocker(channel, other) === null
