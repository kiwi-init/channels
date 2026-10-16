import { describeEvent } from "@mc/format.ts"
import { ignored, type Message } from "@mc/protocol.ts"
import { MAIN, placeKey, type ChannelState } from "@mc/state.ts"
import { formatStamp, memberName } from "@web/lib/format"

export const RUN_GAP_MS = 5 * 60_000

export type Row =
  | { type: "day"; key: string; ts: number; label: string }
  | { type: "event"; key: string; m: Message; text: string; task: number | null }
  | { type: "bubble"; key: string; m: Message; first: boolean; last: boolean; adjacentReply: boolean }

export interface TimelineOptions {
  me: string
  revealed?: boolean
  now?: number
}

function dayStart(ts: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function dayLabel(ts: number, now: number): string {
  const stamp = formatStamp(ts, now)
  const at = stamp.lastIndexOf(" at ")
  return at < 0 ? stamp : stamp.slice(0, at)
}

export function shortEvent(m: Message, state: ChannelState): string {
  const ev = m.ev
  if (!ev) return m.body
  const who = memberName(state.members.get(m.from), m.from)
  const name = (n: string) => memberName(state.members.get(n), n)
  switch (ev.op) {
    case "mode.set":
      return ev.coordinatorOnly ? "Coordinator mode on" : "Coordinator mode off"
    case "role.set":
      return !ev.role ? `${name(ev.member)} has no role now` : ev.role.trim().toLowerCase() === "coordinator" ? `${name(ev.member)} is the coordinator` : `${name(ev.member)} is ${ev.role}`
    case "hold.set":
      return ev.on ? `${who} paused every agent${ev.note ? `: ${ev.note}` : ""}` : `${who} let the agents carry on`
    case "charter.set":
      return ev.text ? `${who} updated the charter` : `${who} cleared the charter`
    case "fact.set":
      return `${who} noted ${ev.key}`
    case "fact.del":
      return `${who} cleared the note ${ev.key}`
    default:
      return `${who} ${describeEvent(m, state)}`
  }
}

export function shows(m: Message, state: ChannelState, revealed: boolean): boolean {
  const place = placeKey(state.placeOf.get(m.seq) ?? MAIN)
  if (place !== "main") return false
  if (m.ev?.op === "hello" || m.ev?.op === "card" || m.ev?.op === "react") return false
  if (!revealed && ignored(state.trust.get(m.seq))) return false
  return true
}

export function buildRows(messages: readonly Message[], state: ChannelState, { me, revealed = false, now = Date.now() }: TimelineOptions): Row[] {
  const visible = messages.filter((m) => shows(m, state, revealed))
  const rows: Row[] = []
  let day = -1
  let previous: Message | null = null
  for (let i = 0; i < visible.length; i++) {
    const m = visible[i]!
    const start = dayStart(m.ts)
    const newDay = start !== day
    if (newDay) {
      day = start
      rows.push({ type: "day", key: `d${start}`, ts: m.ts, label: dayLabel(m.ts, now) })
    }
    if (m.kind === "event") {
      const task = m.ev && "task" in m.ev ? m.ev.task : m.ev?.op === "task.add" ? m.seq : null
      rows.push({ type: "event", key: `e${m.seq}`, m, text: shortEvent(m, state), task })
      previous = null
      continue
    }
    const next = visible[i + 1]
    const joins = (a: Message | null | undefined, b: Message) => !!a && a.kind !== "event" && a.from === b.from && Math.abs(b.ts - a.ts) <= RUN_GAP_MS && dayStart(a.ts) === dayStart(b.ts)
    const first = newDay || !joins(previous, m)
    const last = !next || !joins(m, next)
    const adjacentReply = !!previous && previous.kind !== "event" && !!m.re?.includes(previous.seq)
    rows.push({ type: "bubble", key: `m${m.seq}`, m, first, last, adjacentReply })
    previous = m
  }
  void me
  return rows
}
