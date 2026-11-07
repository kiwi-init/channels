import { useMemo } from "react"

import { channelLanes, dayWindow, HOUR, homeLanes, type Lane } from "~/calm/day"
import type { CalmRow } from "~/calm/rows"
import { takeTurns } from "~/home"
import { Avatar, Count, cx } from "~/kit/bits"
import { clock, useNow } from "~/kit/time"
import { useApp } from "~/nav"

function named(l: Lane, room: number): Lane["spans"][number] | undefined {
  const fits = l.spans.filter((s) => s.to - s.from >= room)
  return fits.filter((s) => s.state !== "done").at(-1) ?? fits.at(-1)
}

const hourOf = (at: number): string => new Date(at).toLocaleTimeString([], { hour: "numeric" })

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
  const { start, end } = dayWindow(since, now)
  const lanes = useMemo(() => (open ? channelLanes(open, start, now) : home ? homeLanes(home, start, now) : []), [open, home, start, now])
  const landed = lanes.flatMap((l) => l.spans).filter((s) => s.state === "done").length
  const x = (t: number): string => `${(((Math.min(Math.max(t, start), end) - start) / (end - start)) * 100).toFixed(3)}%`
  const hours: number[] = []
  for (let h = start; h <= end; h += HOUR) if (Math.abs(h - now) > (end - start) / 12) hours.push(h)
  const first = asks[0]
  const others = rows.filter((r) => r.code !== (open?.code ?? home?.code)).slice(0, 4)
  return (
    <section className="rest-day" aria-label="While you were away">
      {first && (
        <button type="button" className="rest-day-needs" data-afk-open onClick={() => openIt(first.tile.code, true)}>
          <span className="rest-day-needs-head">
            <Count n={asks.length} loud />
            {asks.length === 1 ? "needs you" : "need you"}
          </span>
          <span className="rest-day-needs-first">
            {first.ask.what}: {first.ask.text}
          </span>
          {asks.length > 1 && <span className="rest-day-needs-more">and {asks.length - 1} more</span>}
        </button>
      )}
      {title && (
        <header className="rest-day-head">
          <h2 className="rest-day-title">
            {title} since <span className="mono">{clock(since)}</span>
          </h2>
          <p className="rest-day-sum">
            <span className="is-live">{landed} landed</span>
            <span className="is-doing">{home?.working ?? 0} working</span>
          </p>
        </header>
      )}
      {lanes.length > 0 && (
        <div className="rest-day-grid">
          <div className="rest-day-axis" aria-hidden="true">
            {hours.map((h) => (
              <span key={h} className="mono" style={{ left: x(h) }}>
                {hourOf(h)}
              </span>
            ))}
            <span className="rest-day-now mono" style={{ left: x(now) }}>
              now
            </span>
          </div>
          {lanes.map((l) => (
            <div key={l.name} className="rest-day-lane">
              <span className="rest-day-who">
                <Avatar person={l.face} size="sm" />
                <b>{l.nick}</b>
              </span>
              <span className="rest-day-track">
                <span className="rest-day-track-now" style={{ left: x(now) }} />
                {l.spans.map((s) => (
                  <span key={s.task} className={cx("rest-day-span", `is-${s.state}`)} style={{ left: x(s.from), width: `calc(${x(s.to)} - ${x(s.from)})` }} title={`T${s.task} ${s.title}`}>
                    {s === named(l, (end - start) / 8) && <span className="rest-day-span-name">{s.title}</span>}
                  </span>
                ))}
                {l.asks.map((at) => (
                  <span key={at} className="rest-day-wait" style={{ left: x(at), width: `calc(${x(now)} - ${x(at)})` }} title="Waiting on you" />
                ))}
              </span>
            </div>
          ))}
        </div>
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
