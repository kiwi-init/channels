import { ignored, type Message as Wire } from "@kiwi/core/protocol.ts"
import { MAIN, placeKey, type ChannelState } from "@kiwi/core/state.ts"
import { onItOf, receiptOf, type Busy, type Marks, type OnIt, type Receipt } from "@kiwi/channel/receipts.ts"
import { roomOfMessage } from "@kiwi/app/rooms.ts"
import { liveOf } from "~/doing"
import { span, t } from "~/i18n/i18n"
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
    const on = onItOf(m, state, marks, pkOf, busy, replied(m), now)
    const said = on ? onItWords(on) : receiptWords(receiptOf(m, state, marks, pkOf), time)
    if (said) out.set(m.seq, said)
  }
  return out
}

function receiptWords(r: Receipt | null, time: (at: number) => string): string | null {
  if (!r) return null
  switch (r.kind) {
    case "delivered":
      return t("live.receipts.delivered")
    case "read":
      return r.at === undefined ? t("live.receipts.read") : t("live.receipts.read.at", { time: time(r.at) })
    case "everyone":
      return r.at === undefined ? t("live.receipts.read.everyone") : t("live.receipts.read.everyone.at", { time: time(r.at) })
    case "some":
      return t("live.receipts.read.by", { names: r.names.join(", ") })
    case "count":
      return t("live.receipts.read.count", { read: r.read, of: r.of })
  }
}

function onItWords(o: OnIt): string {
  if (!o.busy) return t("live.receipts.on.it", { name: o.name })
  if (o.minutes < 1) return t("live.receipts.on.it.doing", { name: o.name, doing: o.busy.text })
  const lasted = o.minutes < 60 ? span(o.minutes, "minute") : span(Math.floor(o.minutes / 60), "hour")
  return t("live.receipts.on.it.for", { name: o.name, doing: o.busy.text, time: lasted })
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
