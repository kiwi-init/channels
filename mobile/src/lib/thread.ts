import { ignored, type Message } from "@mc/protocol.ts"
import { MAIN, type ChannelState } from "@mc/state.ts"

export interface ThreadIndex {
  rootOf(seq: number): number | null
  replies: ReadonlyMap<number, Message[]>
}

export function threadIndex(messages: readonly Message[], state: ChannelState, options: { coordinator?: boolean; revealed?: boolean } = {}): ThreadIndex {
  const bySeq = new Map(messages.map((m) => [m.seq, m]))
  const rootOf = (seq: number): number | null => {
    const root = state.threadOf.get(seq)
    if (root === undefined || root === seq) return null
    if (options.coordinator && (state.placeOf.get(seq) ?? MAIN).kind === "main") return null
    const found = bySeq.get(root)
    return found && found.kind !== "event" ? root : null
  }
  const replies = new Map<number, Message[]>()
  for (const m of messages) {
    if (m.kind === "event" || (!options.revealed && ignored(state.trust.get(m.seq)))) continue
    const root = rootOf(m.seq)
    if (root === null) continue
    const list = replies.get(root)
    if (list) list.push(m)
    else replies.set(root, [m])
  }
  return { rootOf, replies }
}

export function repliesLabel(count: number): string {
  return count === 1 ? "1 Reply" : `${count} Replies`
}
