import type { Channel, Message } from "~/model"
import { memberOf } from "~/model"

const RUN_MIN = 2

type Who = Pick<Channel, "people" | "former" | "lead" | "specs">

function isAgent(channel: Who, name: string): boolean {
  return memberOf(channel, name)?.kind === "agent"
}

function isPersonName(channel: Who, name: string): boolean {
  return memberOf(channel, name)?.kind === "human"
}

function isChatter(channel: Who, m: Message, bySeq: ReadonlyMap<number, Message>): boolean {
  if (m.where.kind !== "room" || m.system || m.pending || m.failed !== undefined || m.leftOut || m.deleted) return false
  if (m.ask || m.mentionsYou || m.from === channel.lead || !isAgent(channel, m.from)) return false
  if (m.to?.some((n) => isPersonName(channel, n))) return false
  const quoted = m.replyTo !== undefined ? bySeq.get(m.replyTo) : undefined
  if (quoted && isPersonName(channel, quoted.from)) return false
  return !channel.specs?.some((s) => s.ask === m.seq)
}

export interface ChatterRun {
  first: number
  run: Message[]
}

export function chatterRuns(channel: Who, list: readonly Message[]): Map<number, ChatterRun> {
  const bySeq = new Map(list.map((m) => [m.seq, m]))
  const out = new Map<number, ChatterRun>()
  let i = 0
  while (i < list.length) {
    if (!isChatter(channel, list[i]!, bySeq)) {
      i++
      continue
    }
    let end = i
    while (end < list.length && isChatter(channel, list[end]!, bySeq)) end++
    const run = list.slice(i, end)
    const between = new Set(run.map((m) => m.from)).size > 1 || run.some((m) => m.to?.some((n) => isAgent(channel, n)))
    if (run.length >= RUN_MIN && between) {
      const r = { first: run[0]!.seq, run }
      for (const m of run) out.set(m.seq, r)
    }
    i = end
  }
  return out
}

export function chatterLine(run: readonly Message[], names: (name: string) => string): string {
  const who = [...new Set(run.map((m) => m.from))]
  const tasks = [...new Set(run.flatMap((m) => [...(m.task !== undefined ? [m.task] : []), ...[...m.text.matchAll(/\bT(\d+)\b/g)].map((x) => Number(x[1]))]))].sort((a, b) => a - b)
  const people = who.length <= 3 ? who.map(names).join(", ") : `${who.length} agents`
  const about = tasks.length
    ? ` about ${tasks
        .slice(0, 4)
        .map((t) => `T${t}`)
        .join(", ")}${tasks.length > 4 ? "…" : ""}`
    : ""
  return `${people} · ${run.length} messages between agents${about}`
}
