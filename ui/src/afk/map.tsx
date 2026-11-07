import { useMemo, type CSSProperties } from "react"

import { daylight, type Daylight, type Rgb } from "~/afk/daylight"
import { Avatar, cx } from "~/kit/bits"
import { useNow } from "~/kit/time"
import type { ChannelTile, HomeAgent, HomeChannel } from "~/model"
import { useApp } from "~/nav"

const SPOTS = [
  { x: 22, y: 70 },
  { x: 58, y: 62 },
  { x: 80, y: 78 },
  { x: 40, y: 86 },
] as const
const FACES = 8

interface Pin {
  tile: ChannelTile
  home: HomeChannel
  crew: HomeAgent[]
}

const luma = ([r, g, b]: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

const darkBehind = (d: Daylight): boolean => (luma(d.look.low) + luma(d.look.haze)) / 2 < 0.45

function lineOf(home: HomeChannel): string | null {
  const ask = home.asks[0]
  if (ask) return `${ask.what}: ${ask.text}`
  const moving = home.moving[0]
  if (moving) return `${moving.who ?? "Someone"} on ${moving.title}`
  return home.said ? `${home.said.from}: ${home.said.text}` : null
}

function countsOf(home: HomeChannel): string {
  const needs = home.asks.length
  return (
    [needs ? `${needs} ${needs === 1 ? "needs" : "need"} you` : null, home.working ? `${home.working} working` : null, home.doneToday ? `${home.doneToday} done` : null].filter(Boolean).join(" · ") ||
    "quiet"
  )
}

export function MapView({ open }: { open: (code: string, needs: boolean) => void }) {
  const { app } = useApp()
  const now = useNow(60_000)
  const sky = darkBehind(daylight(new Date(now))) ? "night" : "day"
  const pins = useMemo((): Pin[] => {
    const byCode = new Map(app.home.map((h) => [h.code, h]))
    return app.channels
      .filter((t) => t.state === "member")
      .flatMap((tile) => {
        const home = byCode.get(tile.code)
        return home && !home.loading ? [{ tile, home, crew: home.agents.filter((a) => a.state === "working" || a.state === "waiting") }] : []
      })
      .sort((a, b) => b.home.asks.length - a.home.asks.length || b.home.working - a.home.working || b.tile.last - a.tile.last)
      .slice(0, SPOTS.length)
  }, [app.channels, app.home])
  const faceOf = (pin: Pin, a: HomeAgent) =>
    (app.channel?.code === pin.tile.code ? app.channel.people.find((p) => p.name === a.name) : undefined) ?? { name: a.name, kind: "agent" as const, presence: "online" as const }
  return (
    <div className="afk-map" data-sky={sky}>
      {pins.map((pin, i) => {
        const spot = SPOTS[i]!
        const needs = pin.home.asks.length > 0
        const line = lineOf(pin.home)
        return (
          <div key={pin.tile.code} className={cx("afk-spot", needs && "is-needs")} style={{ left: `${spot.x}%`, top: `${spot.y}%` } as CSSProperties}>
            <button type="button" className="afk-spot-label" data-afk-open onClick={() => open(pin.tile.code, needs)}>
              <b>{pin.tile.title}</b>
              <span className="afk-spot-counts">{countsOf(pin.home)}</span>
              {line && <span className="afk-spot-line">{line}</span>}
              {pin.crew.length > 0 && (
                <span className="afk-spot-crew">
                  {pin.crew.slice(0, FACES).map((a) => (
                    <span key={a.name} className="afk-spot-face" title={`${a.nick} · ${a.task ? a.task.title : a.doing}`}>
                      <Avatar person={faceOf(pin, a)} size="sm" />
                    </span>
                  ))}
                  {pin.crew.length > FACES && <span className="afk-spot-counts">+{pin.crew.length - FACES}</span>}
                </span>
              )}
            </button>
            <span className="afk-spot-stem" aria-hidden="true" />
            <span key={pin.home.asks.length} className="afk-spot-pin" aria-hidden="true" />
          </div>
        )
      })}
    </div>
  )
}
