import { rootOf } from "@kiwi/core/room-rules.ts"
import type { ChannelState } from "@kiwi/core/state.ts"

type LeavingState = Pick<ChannelState, "secret" | "members">

export const leftRoom = (state: LeavingState, id: string, me: string): boolean => !!state.secret.get(id)?.leaving?.includes(rootOf(me, state.members))

export function leaversToSeal(state: LeavingState, me: string): { id: string; names: string[] }[] {
  const out: { id: string; names: string[] }[] = []
  for (const [id, room] of state.secret) {
    if (!room.leaving?.length || !room.meta || leftRoom(state, id, me)) continue
    if (!room.meta.members.some((m) => rootOf(m.name, state.members) === rootOf(me, state.members))) continue
    const names = room.meta.members.map((m) => m.name).filter((name) => room.leaving?.includes(rootOf(name, state.members)))
    if (names.length) out.push({ id, names })
  }
  return out
}
