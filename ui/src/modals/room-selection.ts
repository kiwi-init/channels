import type { Channel } from "../model.ts"
import { roomPeople, seatRoot } from "../names.ts"

export function roomSelection(channel: Pick<Channel, "people" | "you">, members: readonly string[], edits: ReadonlyMap<string, boolean> = new Map()): string[] {
  const roots = new Set(members.map((name) => seatRoot(channel, name)))
  return roomPeople(channel)
    .filter((p) => edits.get(p.name) ?? roots.has(p.name))
    .map((p) => p.name)
}
