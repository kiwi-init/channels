import { liveOf } from "~/doing"
import type { Channel, HomeChannel, Person, PermissionAsk, QuestionAsk, Task } from "~/model"
import { nickname } from "~/names"
import { openAsks } from "~/needs/open"
import { wordsPlain } from "~/words"

const MINUTE = 60_000
export const HOUR = 60 * MINUTE
const BEFORE = 3 * HOUR
const LANES = 7

type SpanState = "done" | "doing" | "review" | "waiting"

interface Span {
  task: number
  title: string
  from: number
  to: number
  state: SpanState
}

type Face = Pick<Person, "name" | "kind" | "harness" | "presence" | "color" | "picture" | "face" | "activity">

interface Now {
  tone: "ask" | "doing" | "review" | "done" | "rest"
  label?: string
  text: string
  live?: string
  since?: number
}

export interface Lane {
  name: string
  nick: string
  face: Face
  spans: Span[]
  now: Now
}

export function dayStart(since: number, now: number): number {
  return Math.ceil(Math.min(since, now - BEFORE) / HOUR) * HOUR
}

interface Asked {
  label: string
  text: string
  at: number
}

function askedOf(a: PermissionAsk | QuestionAsk, nicknames: ReadonlyMap<string, string>): Asked {
  if (a.kind === "question") return { label: "Asks you", text: wordsPlain(a.text, nicknames), at: a.at }
  return { label: a.title.charAt(0).toUpperCase() + a.title.slice(1), text: a.summary || a.code, at: a.at }
}

function nowOf(spans: readonly Span[], ask: Asked | null, live: string | undefined): Now {
  const busy = live ? { live } : {}
  if (ask) return { tone: "ask", label: ask.label, text: ask.text, since: ask.at }
  const open = spans.findLast((s) => s.state !== "done")
  if (open?.state === "waiting") return { tone: "ask", label: "Waiting for you", text: open.title, since: open.from, ...busy }
  if (open) return { tone: open.state, text: open.title, since: open.from, ...busy }
  const last = spans.findLast((s) => s.state === "done")
  if (last) return { tone: "done", text: last.title, since: last.to, ...busy }
  return { tone: "rest", text: live ?? "", ...busy }
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

const RANK: Record<Now["tone"], number> = { ask: 0, doing: 1, review: 2, done: 3, rest: 4 }

const ranked = (a: Lane, b: Lane): number => RANK[a.now.tone] - RANK[b.now.tone] || (b.now.since ?? 0) - (a.now.since ?? 0)

export function channelLanes(ch: Pick<Channel, "people" | "tasks" | "asks" | "nicknames">, start: number, now: number): Lane[] {
  return ch.people
    .filter((p) => p.kind === "agent" && !p.you && !p.left)
    .map((face): Lane => {
      const spans = ch.tasks
        .filter((t) => t.owner === face.name)
        .flatMap((t): Span[] => {
          const state = stateOf(t)
          if (!state) return []
          const to = state === "done" ? endedAt(t) : now
          return to < start ? [] : [{ task: t.id, title: wordsPlain(t.title, ch.nicknames), from: begunAt(t), to, state }]
        })
        .sort((a, b) => a.from - b.from)
      const asked = openAsks(ch)
        .filter((a): a is PermissionAsk | QuestionAsk => (a.kind === "question" || a.kind === "permission") && a.from === face.name)
        .sort((a, b) => a.at - b.at)[0]
      return { name: face.name, nick: nickname(ch, face.name), face, spans, now: nowOf(spans, asked ? askedOf(asked, ch.nicknames) : null, liveOf(face)?.text) }
    })
    .filter((l) => l.spans.length > 0 || l.now.tone === "ask" || l.now.live)
    .sort(ranked)
    .slice(0, LANES)
}

export function homeLanes(home: Pick<HomeChannel, "agents">, start: number, now: number): Lane[] {
  return home.agents
    .filter((a) => a.state === "working" || a.state === "waiting")
    .map((a): Lane => {
      const face: Face = { name: a.name, kind: "agent", presence: "online" }
      const since = a.since ?? now
      if (a.state === "waiting") return { name: a.name, nick: a.nick, face, spans: [], now: { tone: "ask", label: "Waiting for you", text: a.task?.title ?? "", since } }
      const spans: Span[] = a.task ? [{ task: a.task.id, title: a.task.title, from: Math.max(since, start), to: now, state: "doing" }] : []
      return { name: a.name, nick: a.nick, face, spans, now: nowOf(spans, null, a.doing) }
    })
    .sort(ranked)
    .slice(0, LANES)
}
