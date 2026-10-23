import { GENERAL_ROOM, MAX_ROOMS } from "@kiwi/core/protocol.ts"
import { roomName } from "@kiwi/core/state/rooms.ts"
import type { Room } from "@kiwi/core/state/types.ts"

export interface RoomEntry {
  id: string
  name: string
}

export const cleanRoomName = (typed: string): string => roomName(typed.replace(/^[#\s]+/, ""))

export function roomProblem(rooms: Iterable<Pick<Room, "id" | "name">>, typed: string, renaming?: string): string | null {
  const name = cleanRoomName(typed)
  const all = [...rooms]
  if (!name) return "A room needs a name"
  if (all.some((r) => r.id !== renaming && r.name.toLowerCase() === name.toLowerCase())) return `A room is already called #${name}`
  if (!renaming && all.length >= MAX_ROOMS) return `A channel holds at most ${MAX_ROOMS} rooms`
  return null
}

export function roomsAfter(rooms: Iterable<Pick<Room, "id" | "name">>, change: RoomEntry): RoomEntry[] {
  const next = new Map([...rooms].map((r) => [r.id, { id: r.id, name: r.name }]))
  next.set(change.id, { id: change.id, name: change.name })
  return [...next.values()].filter((r) => r.id !== GENERAL_ROOM || r.name !== GENERAL_ROOM)
}
