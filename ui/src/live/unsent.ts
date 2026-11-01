import type { Pending } from "~/live/map"

const byRoom = new Map<string, Pending[]>()
let lastKey = 0

export const nextUnsentKey = (): number => ++lastKey

export const unsentIn = (room: string): Pending[] => byRoom.get(room) ?? []

export function changeUnsent(room: string, change: (list: Pending[]) => Pending[]): Pending[] {
  const next = change(unsentIn(room))
  if (next.length) byRoom.set(room, next)
  else byRoom.delete(room)
  return next
}
