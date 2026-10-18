import type { ChannelState } from "@kiwi/core/state.ts"
import type { Message } from "@kiwi/core/protocol.ts"
import { verdictsAfter } from "@kiwi/core/work.ts"
import type { ReviewCheck } from "@kiwi/core/client.ts"

const memory = new Map<string, number>()
const keyOf = (roomId: string) => `kiwi.reviewChecks.${roomId}`

export function checkedUpTo(roomId: string): number | null {
  try {
    const v = localStorage.getItem(keyOf(roomId))
    return v === null ? null : Number(v)
  } catch {
    // Storage refused (private browsing): remember for this load only.
    return memory.get(roomId) ?? null
  }
}

export function setCheckedUpTo(roomId: string, seq: number): void {
  memory.set(roomId, seq)
  try {
    localStorage.setItem(keyOf(roomId), String(seq))
  } catch {
    // Storage refused: the in-memory mark above still keeps this load from posting twice.
  }
}

export function checksToPost(roomId: string, state: ChannelState, messages: Message[]): (ReviewCheck & { seq: number })[] {
  const after = checkedUpTo(roomId)
  if (after === null) {
    setCheckedUpTo(roomId, state.head)
    return []
  }
  return verdictsAfter(state, messages, after)
}
