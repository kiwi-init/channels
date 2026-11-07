import { ignored, isOverlay, type Message } from "@kiwi/core/protocol.ts"
import { roomOfMessage } from "@kiwi/core/state/rooms.ts"
import type { ChannelState } from "@kiwi/core/state/types.ts"
import type { ModRoomMessage } from "~/mods/protocol"

export const READ_KEEP = 50

export function roomMessages(state: ChannelState, messages: readonly Message[], room: string, keep = READ_KEEP): ModRoomMessage[] {
  if (state.rooms.get(room)?.dm) return []
  const out: ModRoomMessage[] = []
  for (let i = messages.length - 1; i >= 0 && out.length < keep; i--) {
    const m = messages[i]!
    if (m.kind === "event" || !m.sigOk || ignored(state.trust.get(m.seq)) || isOverlay(m) || state.deleted.has(m.seq) || roomOfMessage(state, m) !== room) continue
    const text = (state.edits.get(m.seq)?.body ?? m.body).trim()
    if (text) out.push({ id: m.seq, author: m.from, text, at: m.rts ?? m.ts })
  }
  return out.reverse()
}
