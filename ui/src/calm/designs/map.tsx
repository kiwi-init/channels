import type { CSSProperties } from "react"

import { plural, useAway } from "~/calm/designs/shared"
import { Avatar, cx } from "~/kit/bits"

const SPOTS = [
  { x: 22, y: 70 },
  { x: 58, y: 62 },
  { x: 80, y: 78 },
  { x: 40, y: 86 },
] as const
const CREW_SHOWN = 8

export function MapView({ open }: { open: (code: string) => void }) {
  const away = useAway()
  return (
    <div className="afk-map">
      {away.pairs.slice(0, SPOTS.length).map((p, i) => {
        const spot = SPOTS[i]!
        const needs = p.home.asks.length
        const tone = needs ? "decide" : p.home.working ? "doing" : p.home.doneToday ? "live" : "quiet"
        const crew = away.agents.filter((a) => a.tile.code === p.tile.code && (a.agent.state === "working" || a.agent.state === "waiting"))
        const line = p.home.asks[0]
          ? `${p.home.asks[0].what}: ${p.home.asks[0].text}`
          : p.home.moving[0]
            ? `${p.home.moving[0].who ?? "Someone"} on ${p.home.moving[0].title}`
            : p.home.said
              ? `${p.home.said.from}: ${p.home.said.text}`
              : null
        return (
          <div key={p.tile.code} className={cx("afk-spot", `is-${tone}`)} style={{ left: `${spot.x}%`, top: `${spot.y}%` } as CSSProperties}>
            <button type="button" className="afk-spot-label" data-afk-keep="" onClick={() => open(p.tile.code)}>
              <b>{p.tile.title}</b>
              <span className="afk-meta mono">
                {[needs ? plural(needs, "needs you", "need you") : null, p.home.working ? `${p.home.working} working` : null, p.home.doneToday ? `${p.home.doneToday} done` : null]
                  .filter(Boolean)
                  .join(" · ") || "quiet"}
              </span>
              {line && <span className="afk-spot-line">{line}</span>}
              {crew.length > 0 && (
                <span className="afk-spot-crew">
                  {crew.slice(0, CREW_SHOWN).map((a) => (
                    <span
                      key={a.agent.name}
                      className={cx("afk-spot-face", `is-${a.agent.state}`)}
                      title={`${a.agent.nick} · ${a.agent.task ? `T${a.agent.task.id} ${a.agent.task.title}` : a.agent.doing}`}
                    >
                      <Avatar person={a.person} size="sm" />
                    </span>
                  ))}
                  {crew.length > CREW_SHOWN && <span className="afk-meta mono">+{crew.length - CREW_SHOWN}</span>}
                </span>
              )}
            </button>
            <span className="afk-spot-stem" aria-hidden="true" />
            <span className="afk-spot-pin" aria-hidden="true" />
          </div>
        )
      })}
    </div>
  )
}
