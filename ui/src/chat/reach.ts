import { mentionsOf } from "@kiwi/core/changes.ts"
import { unseenBy } from "@kiwi/core/room-rules.ts"

import { dmInRoom } from "~/live/dm"
import type { Channel, Person, Where } from "~/model"
import { seatRoot, shown } from "~/names"

export type Sealed = { kind: "room"; room: string; inside: readonly string[] } | { kind: "dm"; inside: readonly string[] }

export function sealedOf(channel: Pick<Channel, "rooms" | "directs" | "people" | "you">, where: Where): Sealed | null {
  if (where.kind === "room") {
    const members = channel.rooms.find((r) => r.id === where.room)?.members
    return members ? { kind: "room", room: where.room, inside: members } : null
  }
  if (where.kind === "dm") {
    const membersOnly = channel.directs.find((d) => d.with === where.with)?.membersOnly
    return membersOnly || dmInRoom(channel, where.with) ? { kind: "dm", inside: [channel.you, where.with] } : null
  }
  return null
}

export function outsiders(channel: Pick<Channel, "people">, sealed: Sealed | null, text: string): Person[] {
  if (!sealed) return []
  const named = mentionsOf(text)
  const people = channel.people.filter((p) => !p.left && named.has(p.name.toLowerCase()))
  const out = new Set(
    unseenBy(
      sealed.inside,
      people.map((p) => p.name),
      (name) => seatRoot(channel, name)
    )
  )
  return people.filter((p) => out.has(p.name))
}

export const outside = (channel: Pick<Channel, "people">, sealed: Sealed | null, person: Pick<Person, "name">): boolean =>
  !!sealed && unseenBy(sealed.inside, [person.name], (name) => seatRoot(channel, name)).length > 0

const listed = (xs: readonly string[]): string => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`)

export function warning(sealed: Sealed, people: readonly Person[]): string {
  const names = listed(people.map(shown))
  const one = people.length === 1
  return sealed.kind === "room" ? `${names} ${one ? "isn't" : "aren't"} in this room, so they won't see this.` : `${names} can't see this DM.`
}
