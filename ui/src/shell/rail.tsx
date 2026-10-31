import { Suspense, useEffect, useEffectEvent, useState, type CSSProperties, type DragEvent } from "react"

import { nextWithNews } from "@kiwi/channel/news.ts"
import { cx } from "~/kit/bits"
import { later } from "~/kit/later"
import { Icon } from "~/kit/icons"
import type { ChannelTile } from "~/model"
import { useApp } from "~/nav"
import { useNow } from "~/kit/time"
import type { Menu } from "~/shell/rail-menu"
import { railItems, type DropTarget } from "~/shell/rail-items"
import { pausedLabel, silentNow } from "~/live/quiet"

const RailMenu = later(() => import("~/shell/rail-menu").then((m) => m.default))
const FolderTile = later(() => import("~/shell/rail-folder").then((m) => m.default))

const DRAG = "application/x-kiwi-channel"

const spot = (e: { target: EventTarget }): DropTarget => {
  const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-code],[data-folder]") : null
  const code = el?.dataset["code"]
  const folder = el?.dataset["folder"]
  return code ? { kind: "channel", code } : folder ? { kind: "folder", id: folder } : { kind: "rail" }
}
const keyOf = (t: DropTarget): string => (t.kind === "channel" ? `c:${t.code}` : t.kind === "folder" ? `f:${t.id}` : "rail")

export function Rail() {
  const { app, nav, go } = useApp()
  const now = useNow(60_000)
  const onChannel = nav.page === "channel"
  const home = onChannel && nav.channel === null
  const on = onChannel ? nav.channel : null
  const folders = app.prefs.folders
  const items = railItems(app.channels, folders)
  const ordered = items.flatMap((i) => (i.kind === "channel" ? [i.tile] : i.tiles))
  const [over, setOver] = useState<string | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const save = (next: typeof folders) => app.actions.setPrefs({ folders: next })
  const step = useEffectEvent((dir: 1 | -1) => {
    const from = ordered.findIndex((c) => c.code === on)
    const news = ordered.map((c, i) => ({ open: i === from, fresh: c.unread > 0, needs: c.needsYou, count: c.unread }))
    const next = nextWithNews(ordered, news, from, dir)
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
  const dragOver = (e: DragEvent) => {
    if (!moving) return
    e.preventDefault()
    const t = spot(e)
    setOver(t.kind === "channel" && t.code === moving ? null : keyOf(t))
  }
  const tile = (c: ChannelTile) => <Tile key={c.code} tile={c} on={on === c.code} drop={over === `c:${c.code}`} moving={moving === c.code} onClick={() => go({ to: "channel", code: c.code })} />
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
      <button type="button" className={cx("tile is-home", home && "is-on")} aria-label="Home" aria-current={home ? "page" : undefined} title="Home" onClick={() => go({ to: "home" })}>
        <Icon name="home" size={18} />
      </button>
      <ul
        className={cx("rail-list", moving && "is-moving", over === "rail" && "is-drop")}
        onDragStart={(e) => {
          const t = spot(e)
          if (t.kind !== "channel") return
          e.dataTransfer.setData(DRAG, t.code)
          e.dataTransfer.effectAllowed = "move"
          setMoving(t.code)
        }}
        onDragEnd={() => (setMoving(null), setOver(null))}
        onDragOver={dragOver}
        onDrop={(e) => {
          const code = e.dataTransfer.getData(DRAG)
          const t = spot(e)
          setMoving(null)
          setOver(null)
          if (!code) return
          e.preventDefault()
          void import("~/shell/folders").then((f) => {
            const next = f.dropOn(folders, code, t, f.newFolderId)
            setFresh(next.find((x) => !folders.some((y) => y.id === x.id))?.id ?? null)
            save(next)
          })
        }}
        onContextMenu={(e) => {
          const t = spot(e)
          if (t.kind === "rail") return
          e.preventDefault()
          const top = (e.target as Element).closest("[data-code],[data-folder]")?.getBoundingClientRect().top ?? e.clientY
          setMenu(t.kind === "channel" ? { kind: "channel", code: t.code, top } : { kind: "folder", id: t.id, top })
        }}
      >
        {items.map((item) =>
          item.kind === "channel" ? (
            <li key={item.tile.code}>{tile(item.tile)}</li>
          ) : (
            <li key={item.folder.id} className={cx("rail-folder", item.folder.open && "is-open")}>
              <Suspense fallback={<span className="tile is-folder" />}>
                <FolderTile
                  folder={item.folder}
                  tiles={item.tiles}
                  on={on}
                  drop={over === `f:${item.folder.id}`}
                  fresh={fresh === item.folder.id}
                  onClick={() => save(folders.map((f) => (f.id === item.folder.id ? { ...f, open: !f.open } : f)))}
                />
              </Suspense>
              {item.folder.open && (
                <ul className="rail-folder-list">
                  {item.tiles.map((c, i) => (
                    <li key={c.code} style={{ "--i": i } as CSSProperties}>
                      {tile(c)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        )}
        <li>
          <button type="button" className="tile is-add" aria-label="New channel or join one" title="New channel or join one" onClick={() => go({ to: "dialog", dialog: "new-channel" })}>
            <Icon name="plus" />
          </button>
        </li>
      </ul>
      <div className="rail-foot">
        {silentNow(app.prefs, now) && (
          <button type="button" className="rail-gear is-quiet" aria-label={pausedLabel(app.prefs)} title={pausedLabel(app.prefs)} onClick={() => go({ to: "settings", section: "notifications" })}>
            <Icon name="moon" size={16} />
          </button>
        )}
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
      {menu && (
        <Suspense fallback={null}>
          <RailMenu menu={menu} folders={folders} title={(code) => app.channels.find((c) => c.code === code)?.title ?? code} save={save} close={() => setMenu(null)} />
        </Suspense>
      )}
    </nav>
  )
}

function Tile({ tile, on, drop, moving, onClick }: { tile: ChannelTile; on: boolean; drop: boolean; moving: boolean; onClick: () => void }) {
  const label = [tile.title, tile.muted ? "muted" : "", tile.needsYou ? `${tile.needsYou} need you` : "", tile.unread ? "new messages" : "", tile.state === "waiting" ? "waiting to be let in" : ""]
    .filter(Boolean)
    .join(", ")
  return (
    <button
      type="button"
      draggable
      data-code={tile.code}
      className={cx("tile", on && "is-on", tile.state !== "member" && "is-waiting", drop && "is-drop", moving && "is-moving", tile.muted && "is-muted")}
      aria-current={on ? "page" : undefined}
      aria-label={label}
      title={tile.title}
      onClick={onClick}
    >
      <Face tile={tile} />
      {tile.needsYou > 0 ? <span className="tile-badge">{tile.needsYou}</span> : tile.unread > 0 && !on ? <span className="tile-dot" /> : null}
    </button>
  )
}

export function Face({ tile }: { tile: ChannelTile }) {
  return tile.icon ? <img src={tile.icon} alt="" /> : <span>{tile.title.slice(0, 1).toUpperCase()}</span>
}
