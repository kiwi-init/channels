import { useEffect, useEffectEvent } from "react"

import { nextWithNews } from "@/lib/news"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { ChannelTile } from "~/model"
import { useApp } from "~/nav"

export function Rail() {
  const { app, nav, go } = useApp()
  const onChannel = nav.page === "channel"
  const step = useEffectEvent((dir: 1 | -1) => {
    const from = onChannel ? app.channels.findIndex((c) => c.code === nav.channel) : -1
    const news = app.channels.map((c, i) => ({ open: i === from, fresh: c.unread > 0, needs: c.needsYou, count: c.unread }))
    const next = nextWithNews(app.channels, news, from, dir)
    if (next) go({ to: "channel", code: next.code })
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return
      e.preventDefault()
      e.stopPropagation()
      step(e.key === "ArrowDown" ? 1 : -1)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])
  return (
    <nav className="rail" aria-label="Channels">
      {document.documentElement.dataset["wm"] === "floating" && (
        <div className="wm-controls">
          <button type="button" className="wm-btn is-close" aria-label="Close window" title="Close" onClick={() => app.actions.windowControl("close")}>
            <Icon name="close" size={10} />
          </button>
          <button type="button" className="wm-btn" aria-label="Minimize window" title="Minimize" onClick={() => app.actions.windowControl("minimize")}>
            <Icon name="minus" size={10} />
          </button>
          <button type="button" className="wm-btn" aria-label="Maximize window" title="Maximize" onClick={() => app.actions.windowControl("maximize")}>
            <Icon name="expand" size={10} />
          </button>
        </div>
      )}
      <ul className="rail-list">
        {app.channels.map((c) => (
          <li key={c.code}>
            <Tile tile={c} on={onChannel && nav.channel === c.code} onClick={() => go({ to: "channel", code: c.code })} />
          </li>
        ))}
        <li>
          <button type="button" className="tile is-add" aria-label="New channel or join one" title="New channel or join one" onClick={() => go({ to: "dialog", dialog: "new-channel" })}>
            <Icon name="plus" />
          </button>
        </li>
      </ul>
      {!(onChannel && app.channel) && (
        <div className="rail-foot">
          <button
            type="button"
            className={cx("rail-gear", nav.page === "settings" && "is-on")}
            aria-label="Settings"
            title="Settings"
            onClick={() => (nav.page === "settings" ? go({ to: "back" }) : go({ to: "settings" }))}
          >
            <Icon name="gear" size={18} />
          </button>
        </div>
      )}
    </nav>
  )
}

function Tile({ tile, on, onClick }: { tile: ChannelTile; on: boolean; onClick: () => void }) {
  const label = [tile.title, tile.needsYou ? `${tile.needsYou} need you` : "", tile.unread ? "new messages" : "", tile.state === "waiting" ? "waiting to be let in" : ""].filter(Boolean).join(", ")
  return (
    <button type="button" className={cx("tile", on && "is-on", tile.state !== "member" && "is-waiting")} aria-current={on ? "page" : undefined} aria-label={label} title={tile.title} onClick={onClick}>
      {tile.icon ? <img src={tile.icon} alt="" /> : <span>{tile.title.slice(0, 1).toUpperCase()}</span>}
      {tile.needsYou > 0 ? <span className="tile-badge">{tile.needsYou}</span> : tile.unread > 0 && !on ? <span className="tile-dot" /> : null}
    </button>
  )
}
