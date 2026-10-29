import { ignored, type Message as Wire } from "@kiwi/core/protocol.ts"
import { MAIN, placeKey, type ChannelState } from "@kiwi/core/state.ts"
import { receipt, type Marks } from "@kiwi/channel/receipts.ts"
import { roomOfMessage } from "@/lib/rooms"
import type { Message } from "~/model"

export function receiptsOf(
  state: ChannelState,
  messages: readonly Wire[],
  me: string,
  marks: Marks,
  pkOf: (name: string) => string | undefined,
  time: (at: number) => string
): ReadonlyMap<number, string> {
  const last = new Map<string, Wire>()
  for (const m of messages) {
    if (m.from !== me || m.kind === "event" || m.kind === "done" || ignored(state.trust.get(m.seq))) continue
    const place = state.placeOf.get(m.seq) ?? MAIN
    last.set(place.kind === "main" ? `room:${roomOfMessage(state, m)}` : placeKey(place), m)
    const root = state.threadOf.get(m.seq)
    if (root !== undefined && root !== m.seq) last.set(`thread:${root}`, m)
  }
  const out = new Map<number, string>()
  for (const m of new Set(last.values())) {
    const said = receipt(m, state, marks, pkOf, time)
    if (said) out.set(m.seq, said)
  }
  return out
}

export function withReceipts(messages: Message[], receipts: ReadonlyMap<number, string>): Message[] {
  if (!receipts.size) return messages
  return messages.map((m) => {
    const said = receipts.get(m.seq)
    return said ? { ...m, receipt: said } : m
  })
}
