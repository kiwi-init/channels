import type { Pending } from "~/live/map"
import type { SendExtras, Where } from "~/model"

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

export const unsentBlock = (list: readonly Pending[], key: number): string | null => list.find((p) => p.key === key)?.block?.id ?? null

export const resendOf = (p: Pending): SendExtras => ({
  ...(p.inThread !== undefined ? { inThread: p.inThread } : {}),
  ...(p.side ? { side: true as const } : {}),
  ...(p.replyTo !== undefined ? { replyTo: p.replyTo } : {}),
  ...(p.images?.length ? { images: p.images } : {}),
  ...(p.block ? { block: p.block } : {}),
})

export async function retryUnsent(list: readonly Pending[], key: number, drop: (key: number) => void, post: (where: Where, text: string, extras: SendExtras) => Promise<number>): Promise<number> {
  const p = list.find((x) => x.key === key)
  if (!p) throw new Error("that message is gone")
  drop(key)
  return post(p.where, p.text, resendOf(p))
}
