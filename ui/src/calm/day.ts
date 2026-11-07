import type { Channel, HomeChannel, Person, Task } from "~/model"
import { nickname } from "~/names"
import { openAsks } from "~/needs/open"
import { wordsPlain } from "~/words"

const MINUTE = 60_000
export const HOUR = 60 * MINUTE
const BEFORE = 4 * HOUR
const AHEAD = 15 * MINUTE
const LANES = 7
const SOON = 5 * MINUTE

type SpanState = "done" | "doing" | "review" | "waiting"

interface Span {
  task: number
  title: string
  from: number
  to: number
  state: SpanState
}

type Face = Pick<Person, "name" | "kind" | "harness" | "presence" | "color" | "picture" | "face" | "activity">

export interface Lane {
  name: string
  nick: string
  face: Face
  spans: Span[]
  asks: number[]
}

export function dayWindow(since: number, now: number): { start: number; end: number } {
  return { start: Math.ceil(Math.min(since, now - BEFORE) / HOUR) * HOUR, end: now + AHEAD }
}

function begunAt(t: Task): number {
  return t.history.find((h) => h.what === "started" || h.what === "took" || h.what === "assigned")?.at ?? t.createdAt
}

function endedAt(t: Task): number {
  return t.history.findLast((h) => h.what === "done")?.at ?? t.pr?.mergedAt ?? t.updatedAt
}

function stateOf(t: Task): SpanState | null {
  if (t.cancelled || t.archived) return null
  if (t.status === "done") return "done"
  if (t.status === "doing") return "doing"
  if (t.status === "review" || t.status === "landing") return "review"
  if (t.status === "waiting") return "waiting"
  return null
}

const latest = (l: Lane): number => Math.max(0, ...l.spans.map((s) => s.to), ...l.asks)

export function channelLanes(ch: Pick<Channel, "people" | "tasks" | "asks" | "nicknames">, start: number, now: number): Lane[] {
  const asks = openAsks(ch).flatMap((a) => (a.kind === "question" || a.kind === "permission" ? [{ from: a.from, at: a.at }] : []))
  return ch.people
    .filter((p) => p.kind === "agent" && !p.you && !p.left)
    .map((face): Lane => {
      const spans = ch.tasks
        .filter((t) => t.owner === face.name)
        .flatMap((t): Span[] => {
          const state = stateOf(t)
          if (!state) return []
          const from = begunAt(t)
          const to = state === "done" ? endedAt(t) : now
          if (to < start) return []
          return [{ task: t.id, title: wordsPlain(t.title, ch.nicknames), from: Math.max(from, start), to, state }]
        })
      return { name: face.name, nick: nickname(ch, face.name), face, spans, asks: asks.filter((a) => a.from === face.name).map((a) => Math.max(a.at, start)) }
    })
    .filter((l) => l.spans.length || l.asks.length)
    .sort((a, b) => latest(b) - latest(a))
    .slice(0, LANES)
}

export function homeLanes(home: Pick<HomeChannel, "agents">, start: number, now: number): Lane[] {
  return home.agents
    .filter((a) => a.state === "working" || a.state === "waiting")
    .map((a): Lane => {
      const from = Math.max(a.since ?? now - SOON, start)
      const face: Face = { name: a.name, kind: "agent", presence: "online" }
      if (a.state === "waiting") return { name: a.name, nick: a.nick, face, spans: [], asks: [from] }
      const spans: Span[] = a.task ? [{ task: a.task.id, title: a.task.title, from, to: now, state: "doing" }] : []
      return { name: a.name, nick: a.nick, face, spans, asks: [] }
    })
    .filter((l) => l.spans.length || l.asks.length)
    .slice(0, LANES)
}
