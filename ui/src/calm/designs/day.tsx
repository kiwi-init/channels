import { useMemo } from "react"

import { plural, useAway } from "~/calm/designs/shared"
import { Avatar, cx } from "~/kit/bits"
import { clock, useNow } from "~/kit/time"
import type { Channel, Person, Task } from "~/model"
import { nickname } from "~/names"
import { useApp } from "~/nav"
import { wordsPlain } from "~/words"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const BEFORE = 4 * HOUR
const AHEAD = HOUR
const LANES = 7
const USUAL = 35 * MINUTE

type SpanState = "done" | "doing" | "review" | "waiting"

interface Span {
  task: number
  title: string
  from: number
  to: number
  state: SpanState
  until?: number
}

interface Lane {
  person: Person
  nick: string
  spans: Span[]
  asks: number[]
}

function begunAt(t: Task): number {
  return t.history.find((h) => h.what === "started" || h.what === "took" || h.what === "assigned")?.at ?? t.createdAt
}

function endedAt(t: Task): number {
  return [...t.history].reverse().find((h) => h.what === "done")?.at ?? t.pr?.mergedAt ?? t.updatedAt
}

function stateOf(t: Task): SpanState | null {
  if (t.cancelled || t.archived) return null
  if (t.status === "done") return "done"
  if (t.status === "doing") return "doing"
  if (t.status === "review" || t.status === "landing") return "review"
  if (t.status === "waiting") return "waiting"
  return null
}

export function usual(tasks: readonly Task[]): number {
  const took = tasks
    .filter((t) => t.status === "done" && !t.cancelled)
    .map((t) => endedAt(t) - begunAt(t))
    .filter((d) => d > MINUTE && d < 8 * HOUR)
    .sort((a, b) => a - b)
  return took.length ? took[Math.floor(took.length / 2)]! : USUAL
}

function lanesOf(ch: Channel, start: number, now: number): Lane[] {
  const typical = usual(ch.tasks)
  const asks = ch.asks.flatMap((a) => (a.kind === "question" || a.kind === "permission" ? [{ from: a.from, at: a.at }] : []))
  return ch.people
    .filter((p) => p.kind === "agent" && !p.you && !p.left)
    .map((person) => {
      const spans = ch.tasks
        .filter((t) => t.owner === person.name)
        .flatMap((t): Span[] => {
          const state = stateOf(t)
          if (!state) return []
          const from = begunAt(t)
          const to = state === "done" ? endedAt(t) : now
          if (to < start) return []
          const until = state === "doing" ? Math.max(now + 5 * MINUTE, from + typical) : undefined
          return [{ task: t.id, title: wordsPlain(t.title, ch.nicknames), from: Math.max(from, start), to, state, ...(until ? { until } : {}) }]
        })
      return { person, nick: nickname(ch, person.name), spans, asks: asks.filter((a) => a.from === person.name).map((a) => a.at) }
    })
    .filter((l) => l.spans.length || l.asks.length)
    .sort((a, b) => Math.max(0, ...b.spans.map((s) => s.to)) - Math.max(0, ...a.spans.map((s) => s.to)))
    .slice(0, LANES)
}

export function Day({ since }: { since: number }) {
  const { app } = useApp()
  const away = useAway()
  const now = useNow(30_000)
  const ch = app.channel
  const start = Math.floor((Math.min(since, now - BEFORE) - 1) / HOUR) * HOUR + HOUR
  const end = now + AHEAD
  const lanes = useMemo(() => (ch ? lanesOf(ch, start, now) : []), [ch, start, now])
  if (!ch) return null
  const x = (t: number): string => `${(((Math.min(Math.max(t, start), end) - start) / (end - start)) * 100).toFixed(3)}%`
  const hours: number[] = []
  for (let h = start; h <= end; h += HOUR) hours.push(h)
  const landed = lanes.flatMap((l) => l.spans).filter((s) => s.state === "done").length
  const here = away.pairs.find((p) => p.tile.code === ch.code)?.home
  const needs = here?.asks.length ?? 0
  const working = here?.working ?? 0
  return (
    <section className="afk-day afk-float" aria-label="Your day">
      <header className="afk-day-head">
        <h2 className="afk-day-title">
          {ch.title} since <span className="mono">{clock(since)}</span>
        </h2>
        <p className="afk-day-sum">
          <span className="is-live">{landed} landed</span>
          <span className="is-decide">{plural(needs, "needs you", "need you")}</span>
          <span className="is-doing">{working} working</span>
        </p>
      </header>
      <div className="afk-day-grid">
        <div className="afk-day-axis" aria-hidden="true">
          {hours.map((h) => (
            <span key={h} className="mono" style={{ left: x(h) }}>
              {clock(h)}
            </span>
          ))}
          <span className="afk-day-now mono" style={{ left: x(now) }}>
            now
          </span>
        </div>
        {lanes.map((l) => (
          <div key={l.person.name} className="afk-lane">
            <span className="afk-lane-who">
              <Avatar person={l.person} size="sm" />
              <b>{l.nick}</b>
            </span>
            <span className="afk-track">
              <span className="afk-track-now" style={{ left: x(now) }} />
              {l.spans.map((s) => (
                <span key={s.task} title={`T${s.task} ${s.title}`}>
                  <span className={cx("afk-span", `is-${s.state}`)} style={{ left: x(s.from), width: `calc(${x(s.to)} - ${x(s.from)})` }}>
                    <span className="afk-span-id mono">T{s.task}</span>
                  </span>
                  {s.until && <span className="afk-span is-ahead" style={{ left: x(s.to), width: `calc(${x(s.until)} - ${x(s.to)})` }} />}
                  {s.until && (
                    <span className="afk-eta mono" style={{ left: x(s.until) }}>
                      ≈ {clock(s.until)}
                    </span>
                  )}
                </span>
              ))}
              {l.asks.map((at) => (
                <span key={at} className="afk-wait" style={{ left: x(at), width: `calc(${x(now)} - ${x(at)})` }} title="Waiting on you" />
              ))}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
