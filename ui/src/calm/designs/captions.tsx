import { useEffect, useMemo, useState } from "react"

import { Answer, plural, useAway, type AgentAt, type AskAt, type Away } from "~/calm/designs/shared"
import { Avatar, Count, cx } from "~/kit/bits"
import { ago, useNow } from "~/kit/time"

const HOLD_MS = 7000

interface Cap {
  key: string
  tone: "decide" | "doing" | "live" | "quiet"
  who?: AgentAt["person"]
  lead: string
  text: string
  meta: string
  ask?: AskAt
}

function captionsOf(away: Away, now: number): Cap[] {
  const asks = away.asks.map((at): Cap => ({
    key: `ask:${at.tile.code}:${at.ask.id}`,
    tone: "decide",
    lead: at.ask.what,
    text: at.ask.text,
    meta: `${at.tile.title} · ${ago(at.ask.at, now)}`,
    ask: at,
  }))
  const agents = away.agents
    .filter((a) => a.agent.state === "working")
    .map((a): Cap => ({
      key: `agent:${a.tile.code}:${a.agent.name}`,
      tone: "doing",
      who: a.person,
      lead: a.agent.nick,
      text: a.agent.task ? a.agent.task.title : a.agent.doing,
      meta: [a.tile.title, a.agent.task ? `T${a.agent.task.id}` : null, a.agent.doing, a.agent.since ? ago(a.agent.since, now) : null].filter(Boolean).join(" · "),
    }))
  const said = away.pairs.flatMap((p) =>
    p.home.said ? [{ key: `said:${p.tile.code}`, tone: "quiet" as const, lead: p.home.said.from, text: p.home.said.text, meta: `${p.tile.title} · #general · ${ago(p.home.said.at, now)}` }] : []
  )
  const done = away.pairs.flatMap((p) =>
    p.home.doneToday
      ? [{ key: `done:${p.tile.code}`, tone: "live" as const, lead: p.tile.title, text: `${plural(p.home.doneToday, "task", "tasks")} landed today`, meta: `${p.tile.title} · today` }]
      : []
  )
  return [...asks, ...agents, ...done, ...said]
}

export function Captions({ open, still }: { open: (code: string) => void; still: boolean }) {
  const away = useAway()
  const now = useNow(60_000)
  const caps = useMemo(() => captionsOf(away, now), [away, now])
  const [at, setAt] = useState(0)
  useEffect(() => {
    if (still || caps.length < 2) return
    const timer = window.setInterval(() => setAt((i) => (i + 1) % caps.length), HOLD_MS)
    return () => window.clearInterval(timer)
  }, [still, caps.length])
  const cap = caps[at % Math.max(1, caps.length)]
  if (!cap) return null
  return (
    <>
      {away.asks.length > 0 && (
        <p className="afk-corner afk-float">
          Needs you <Count n={away.asks.length} loud />
        </p>
      )}
      <section className="afk-captions" aria-live="polite" aria-label="What is happening">
        <ol className="afk-ticks" aria-hidden="true">
          {caps.map((c, i) => (
            <li key={c.key} className={cx(`is-${c.tone}`, i === at % caps.length && "is-on")} />
          ))}
        </ol>
        <div key={cap.key} className={cx("afk-caption afk-float", `is-${cap.tone}`)}>
          <p className="afk-caption-lead">
            {cap.who ? <Avatar person={cap.who} size="sm" /> : <span className="afk-tone" aria-hidden="true" />}
            <b>{cap.lead}</b>
            <span className="afk-meta mono">{cap.meta}</span>
          </p>
          <p className="afk-caption-text">{cap.text}</p>
          {cap.ask && <Answer at={cap.ask} onOpen={open} />}
        </div>
      </section>
    </>
  )
}
