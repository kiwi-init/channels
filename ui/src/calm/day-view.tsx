import { useMemo } from "react"

import { channelLanes, dayStart, HOUR, homeLanes, type Lane } from "~/calm/day"
import type { CalmRow } from "~/calm/rows"
import { takeTurns } from "~/home"
import { Avatar, Count, cx } from "~/kit/bits"
import { ago, clock, useNow } from "~/kit/time"
import { useApp } from "~/nav"

const hourOf = (at: number): string => new Date(at).toLocaleTimeString([], { hour: "numeric" })

function whenOf({ tone, live, since }: Lane["now"], now: number): string {
  const was = since ? ago(since, now) : null
  const back = was === "now" ? "just now" : was && `${was} ago`
  if (tone === "ask") return back ?? ""
  if (tone === "doing") return live ? [live, was !== "now" && was].filter(Boolean).join(" · ") : back ? `started ${back}` : ""
  if (tone === "review") return was ? `in review · ${was}` : "in review"
  if (tone === "done") return back ? `landed ${back}` : "landed"
  return ""
}

export function DayView({ since, rows, open: openIt }: { since: number; rows: readonly CalmRow[]; open: (code: string, needs: boolean) => void }) {
  const { app } = useApp()
  const now = useNow(30_000)
  const members = useMemo(() => app.channels.filter((t) => t.state === "member"), [app.channels])
  const byCode = useMemo(() => new Map(app.home.map((h) => [h.code, h])), [app.home])
  const asks = takeTurns(members.map((t) => (byCode.get(t.code)?.asks ?? []).map((ask) => ({ tile: t, ask }))))
  const open = app.channel && members.some((t) => t.code === app.channel?.code) ? app.channel : null
  const busiest = [...app.home].filter((h) => !h.loading && members.some((t) => t.code === h.code)).sort((a, b) => b.working - a.working || b.asks.length - a.asks.length)[0]
  const home = open ? byCode.get(open.code) : busiest
  const title = open?.title ?? home?.title ?? null
  const start = dayStart(since, now)
  const lanes = useMemo(() => (open ? channelLanes(open, start, now) : home ? homeLanes(home, start, now) : []), [open, home, start, now])
  const landed = lanes.flatMap((l) => l.spans).filter((s) => s.state === "done" && s.to >= since).length
  const x = (t: number): string => `${(((Math.min(Math.max(t, start), now) - start) / (now - start)) * 100).toFixed(3)}%`
  const hours: number[] = []
  for (let h = start + HOUR; h < now - (now - start) / 8; h += HOUR) hours.push(h)
  const first = asks[0]
  const others = rows.filter((r) => r.code !== (open?.code ?? home?.code)).slice(0, 4)
  return (
    <section className="rest-day" aria-label="While you were away">
      {first && (
        <button type="button" className="rest-day-needs" data-afk-open onClick={() => openIt(first.tile.code, true)}>
          <Count n={asks.length} loud />
          <b>{asks.length === 1 ? "needs you" : "need you"}</b>
          <span className="rest-day-needs-first">
            {first.ask.what}: {first.ask.text}
          </span>
          {asks.length > 1 && <span className="rest-day-needs-more">and {asks.length - 1} more</span>}
        </button>
      )}
      {lanes.length > 0 && (
        <ol className="rest-day-lanes">
          <li className="rest-day-row rest-day-axis" aria-hidden="true">
            <b>{title}</b>
            <span className="rest-day-hours mono">
              {hours.map((h) => (
                <span key={h} style={{ left: x(h) }}>
                  {hourOf(h)}
                </span>
              ))}
              <span className="is-now">now</span>
            </span>
            <span className="mono">
              away since {clock(since)}
              {landed > 0 && ` · ${landed} landed`}
            </span>
          </li>
          {lanes.map((l) => {
            const when = whenOf(l.now, now)
            return (
              <li key={l.name} className={cx("rest-day-row", `is-${l.now.tone}`)}>
                <span className="rest-day-who">
                  <Avatar person={l.face} size="sm" />
                  <span className="rest-day-nick">{l.nick}</span>
                </span>
                <span className="rest-day-track" aria-hidden="true">
                  <span className="rest-day-past">
                    {l.spans.map((s) => (
                      <span key={s.task} className={cx("rest-day-span", `is-${s.state}`)} style={{ left: x(s.from), width: `calc(${x(s.to)} - ${x(s.from)})` }} />
                    ))}
                    {l.now.tone === "ask" && l.now.since && <span className="rest-day-span is-waiting" style={{ left: x(l.now.since), width: `calc(100% - ${x(l.now.since)})` }} />}
                  </span>
                  {l.now.tone !== "done" && l.now.tone !== "rest" && <span className="rest-day-dot" />}
                </span>
                <span className="rest-day-what">
                  {l.now.label && <b>{l.now.label}</b>}
                  <span className="rest-day-text">{l.now.text}</span>
                  {when && <span className="rest-day-when mono">{when}</span>}
                </span>
              </li>
            )
          })}
        </ol>
      )}
      {others.length > 0 && (
        <nav className="rest-day-also" aria-label="Other channels">
          {others.map((r) => {
            const working = byCode.get(r.code)?.working ?? 0
            return (
              <button key={r.code} type="button" data-afk-open onClick={() => openIt(r.code, false)}>
                <span>{r.title}</span>
                <span className={cx("mono", r.needs > 0 && "is-ask")}>{r.needs > 0 ? `${r.needs} ${r.needs === 1 ? "needs" : "need"} you` : working > 0 ? `${working} working` : "quiet"}</span>
              </button>
            )
          })}
        </nav>
      )}
    </section>
  )
}
