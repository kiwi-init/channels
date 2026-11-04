import type { Pending } from "~/live/map"
import type { SendExtras } from "~/model"

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

export const resendOf = (p: Pending): SendExtras => ({
  ...(p.inThread !== undefined ? { inThread: p.inThread } : {}),
  ...(p.side ? { side: true as const } : {}),
  ...(p.replyTo !== undefined ? { replyTo: p.replyTo } : {}),
  ...(p.images?.length ? { images: p.images } : {}),
  ...(p.block ? { block: p.block } : {}),
})
