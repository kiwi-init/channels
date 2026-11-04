import { ignored, type Message as Wire } from "@kiwi/core/protocol.ts"
import { MAIN, placeKey, type ChannelState } from "@kiwi/core/state.ts"
import { onIt, receipt, type Busy, type Marks } from "@kiwi/channel/receipts.ts"
import { roomOfMessage } from "@kiwi/app/rooms.ts"
import { liveOf } from "~/doing"
import type { Message, Person } from "~/model"

export function receiptsOf(
  state: ChannelState,
  messages: readonly Wire[],
  me: string,
  marks: Marks,
  pkOf: (name: string) => string | undefined,
  time: (at: number) => string,
  busy: (name: string) => Busy | null = () => null,
  now = Date.now()
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
  const replied = (m: Wire) => (from: readonly string[]) => {
    const root = state.threadOf.get(m.seq) ?? m.seq
    return messages.some((x) => x.seq > m.seq && x.kind !== "event" && from.includes(x.from) && (x.re?.includes(m.seq) || state.threadOf.get(x.seq) === root))
  }
  for (const m of new Set(last.values())) {
    const said = onIt(m, state, marks, pkOf, busy, replied(m), now) ?? receipt(m, state, marks, pkOf, time)
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

export function busyOf(people: readonly Person[]): (name: string) => Busy | null {
  const by = new Map<string, Busy>()
  for (const p of people) {
    const live = liveOf(p)
    if (live?.busy) by.set(p.name, { text: live.text, ...(live.since ? { since: live.since } : {}) })
  }
  return (name) => by.get(name) ?? null
}
