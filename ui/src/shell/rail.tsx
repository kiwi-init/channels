import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { ChannelTile } from "~/model"
import { useApp } from "~/nav"

export function Rail() {
  const { app, nav, go } = useApp()
  const onChannel = nav.page === "channel"
  return (
    <nav className="rail" aria-label="Channels">
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
      <button
        type="button"
        className={cx("rail-me", nav.page === "settings" && "is-on", app.account?.update?.ready && "has-update")}
        aria-label={app.account?.update?.ready ? "Settings, an update is ready" : "Settings"}
        title="Settings"
        onClick={() => (nav.page === "settings" ? go({ to: "back" }) : go({ to: "settings" }))}
      >
        {app.account?.name.slice(0, 1).toUpperCase()}
      </button>
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
