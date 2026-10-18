import type { ChannelState } from "@kiwi/core/state.ts"
import type { Message } from "@kiwi/core/protocol.ts"
import { prsToLinkBack, verdictsAfter } from "@kiwi/core/work.ts"
import type { ReviewCheck } from "@kiwi/core/client.ts"

const memory = new Map<string, number>()
type Mark = "reviewChecks" | "prLinks"
const keyOf = (mark: Mark, roomId: string) => `kiwi.${mark}.${roomId}`

export function checkedUpTo(roomId: string, mark: Mark = "reviewChecks"): number | null {
  try {
    const v = localStorage.getItem(keyOf(mark, roomId))
    return v === null ? null : Number(v)
  } catch {
    // Storage refused (private browsing): remember for this load only.
    return memory.get(keyOf(mark, roomId)) ?? null
  }
}

export function setCheckedUpTo(roomId: string, seq: number, mark: Mark = "reviewChecks"): void {
  memory.set(keyOf(mark, roomId), seq)
  try {
    localStorage.setItem(keyOf(mark, roomId), String(seq))
  } catch {
    // Storage refused: the in-memory mark above still keeps this load from posting twice.
  }
}

export function linksToPost(roomId: string, state: ChannelState): ReturnType<typeof prsToLinkBack> {
  const after = checkedUpTo(roomId, "prLinks")
  if (after === null) {
    setCheckedUpTo(roomId, state.head, "prLinks")
    return []
  }
  return prsToLinkBack(state, after)
}

export function checksToPost(roomId: string, state: ChannelState, messages: Message[]): (ReviewCheck & { seq: number })[] {
  const after = checkedUpTo(roomId)
  if (after === null) {
    setCheckedUpTo(roomId, state.head)
    return []
  }
  return verdictsAfter(state, messages, after)
}
