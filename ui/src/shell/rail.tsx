import { Suspense, useEffect, useEffectEvent, useLayoutEffect, useState, type CSSProperties, type DragEvent } from "react"

import { nextWithNews } from "@kiwi/channel/news.ts"
import { cx } from "~/kit/bits"
import { later } from "~/kit/later"
import { Icon } from "~/kit/icons"
import type { ChannelTile } from "~/model"
import { channelOf, onCommand } from "~/kit/commands"
import { inText } from "~/kit/keys"
import { useNav, useGo, useActions, useTiles, useAppPrefs } from "~/nav"
import { openMenu } from "~/kit/menu-open"
import { railItems, type DropTarget } from "~/shell/rail-items"
import { useTabs } from "~/shell/top-layout"
import { t } from "~/i18n/i18n"
import { useSidebarHidden } from "@kiwi/app/sidebar-hidden.ts"

const FolderTile = later(() => import("~/shell/rail-folder").then((m) => m.default))
const UsageMeter = later(() => import("~/usage/meter").then((m) => m.UsageMeter))
const RailCards = later(() => import("~/shell/updates").then((m) => m.RailCards))

const DRAG = "application/x-kiwi-channel"

const spot = (e: { target: EventTarget }): DropTarget => {
  const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-code],[data-folder]") : null
  const code = el?.dataset["code"]
  const folder = el?.dataset["folder"]
  return code ? { kind: "channel", code } : folder ? { kind: "folder", id: folder } : { kind: "rail" }
}
const keyOf = (target: DropTarget): string => (target.kind === "channel" ? `c:${target.code}` : target.kind === "folder" ? `f:${target.id}` : "rail")

export function Rail() {
  const nav = useNav()
  const go = useGo()
  const actions = useActions()
  const tiles = useTiles()
  const prefs = useAppPrefs()
  const onChannel = nav.page === "channel"
  const home = onChannel && nav.channel === null
  const sidebarHidden = useSidebarHidden()
  const tabs = useTabs()
  useLayoutEffect(() => {
    const root = document.documentElement
    root.toggleAttribute("data-tabs", tabs)
    return () => root.removeAttribute("data-tabs")
  }, [tabs])
  const cardsHere = onChannel && (home || sidebarHidden)
  const on = onChannel ? nav.channel : null
  const folders = prefs.folders
  const items = railItems(tiles, folders)
  const ordered = items.flatMap((i) => (i.kind === "channel" ? [i.tile] : i.tiles))
  const [over, setOver] = useState<string | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [hint, setHint] = useState<{ name: string; x: number; y: number } | null>(null)
  const point = (e: { target: EventTarget }) => {
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-code],[data-folder]") : null
    const name = el?.dataset["code"] ? tiles.find((c) => c.code === el.dataset["code"])?.title : folders.find((f) => f.id === el?.dataset["folder"])?.name
    if (!el || !name || moving) return setHint(null)
    const box = el.getBoundingClientRect()
    setHint({ name, x: box.left + box.width / 2, y: box.bottom + 4 })
  }
  const save = (next: typeof folders) => actions.setPrefs({ folders: next })
  const step = useEffectEvent((dir: 1 | -1) => {
    const from = ordered.findIndex((c) => c.code === on)
    const news = ordered.map((c, i) => ({ open: i === from, fresh: c.unread > 0, needs: c.needsYou, count: c.unread }))
    const next = nextWithNews(ordered, news, from, dir)
    if (next) go({ to: "channel", code: next.code })
  })
  const pick = useEffectEvent((n: number | null) => {
    const tile = n === null ? undefined : ordered[n - 1]
    if (tile) go({ to: "channel", code: tile.code })
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return
      if (inText(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      step(e.key === "ArrowDown" ? 1 : -1)
    }
    const stop = onCommand((c) => pick(channelOf(c)))
    window.addEventListener("keydown", onKey, true)
    return () => {
      stop()
      window.removeEventListener("keydown", onKey, true)
    }
  }, [])
  const dragOver = (e: DragEvent) => {
    if (!moving) return
    e.preventDefault()
    const target = spot(e)
    setOver(target.kind === "channel" && target.code === moving ? null : keyOf(target))
  }
  const tile = (c: ChannelTile) => <Tile key={c.code} tile={c} on={on === c.code} drop={over === `c:${c.code}`} moving={moving === c.code} onClick={() => go({ to: "channel", code: c.code })} />
  return (
    <nav className="rail" aria-label={t("shell.rail.channels")}>
      {document.documentElement.dataset["wm"] === "floating" && (
        <div className="wm-controls">
          <button type="button" className="wm-btn is-close" aria-label={t("shell.rail.close.window")} title={t("shell.rail.close")} onClick={() => actions.windowControl("close")}>
            <Icon name="close" size={10} />
          </button>
          <button type="button" className="wm-btn" aria-label={t("shell.rail.minimize.window")} title={t("shell.rail.minimize")} onClick={() => actions.windowControl("minimize")}>
            <Icon name="minus" size={10} />
          </button>
          <button type="button" className="wm-btn" aria-label={t("shell.rail.maximize.window")} title={t("shell.rail.maximize")} onClick={() => actions.windowControl("maximize")}>
            <Icon name="expand" size={10} />
          </button>
        </div>
      )}
      <button
        type="button"
        className={cx("tile is-home", home && "is-on")}
        aria-label={t("shell.rail.home")}
        aria-current={home ? "page" : undefined}
        title={t("shell.rail.home")}
        onClick={() => go({ to: "home" })}
      >
        <Icon name="home" size={18} />
      </button>
      <ul
        className={cx("rail-list", moving && "is-moving", over === "rail" && "is-drop")}
        onMouseOver={point}
        onMouseLeave={() => setHint(null)}
        onMouseDown={() => setHint(null)}
        onScroll={() => setHint(null)}
        onDragStart={(e) => {
          const target = spot(e)
          if (target.kind !== "channel") return
          e.dataTransfer.setData(DRAG, target.code)
          e.dataTransfer.effectAllowed = "move"
          setMoving(target.code)
        }}
        onDragEnd={() => (setMoving(null), setOver(null))}
        onDragOver={dragOver}
        onDrop={(e) => {
          const code = e.dataTransfer.getData(DRAG)
          const target = spot(e)
          setMoving(null)
          setOver(null)
          if (!code) return
          e.preventDefault()
          void import("~/shell/folders").then((f) => {
            const next = f.dropOn(folders, code, target, f.newFolderId)
            setFresh(next.find((x) => !folders.some((y) => y.id === x.id))?.id ?? null)
            save(next)
          })
        }}
        onContextMenu={(e) => {
          const target = spot(e)
          if (target.kind === "rail") return
          e.preventDefault()
          const box = (e.target as Element).closest("[data-code],[data-folder]")?.getBoundingClientRect()
          const at = { x: box?.left ?? e.clientX, y: (box?.bottom ?? e.clientY) + 4 }
          setHint(null)
          void import("~/shell/rail-menu").then((m) =>
            openMenu.set(
              m.railMenu(target, at, {
                folders,
                title: (code) => tiles.find((c) => c.code === code)?.title ?? code,
                muted: (code) => prefs.muted.includes(code),
                setMute: (code, on) => actions.setMute(code, null, on),
                settings:
                  target.kind === "channel" && tiles.find((c) => c.code === target.code)?.state === "member"
                    ? (code) => {
                        go({ to: "channel", code })
                        go({ to: "modal", modal: { kind: "channel" } })
                      }
                    : null,
                own: target.kind === "channel" ? tiles.find((c) => c.code === target.code)?.own : undefined,
                read:
                  target.kind === "channel" && (tiles.find((c) => c.code === target.code)?.unread ?? 0) > 0 ? (code) => actions.markChannelRead(code, tiles.find((c) => c.code === code)?.head) : null,
                invite: (code) => {
                  go({ to: "channel", code })
                  go({ to: "modal", modal: { kind: "invite" } })
                },
                end: (code) => {
                  go({ to: "channel", code })
                  go({ to: "modal", modal: { kind: "channel", end: true } })
                },
                save,
              })
            )
          )
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
          <button type="button" className="tile is-add" aria-label={t("shell.rail.new.channel")} title={t("shell.rail.new.channel")} onClick={() => go({ to: "dialog", dialog: "new-channel" })}>
            <Icon name="plus" />
          </button>
        </li>
      </ul>
      {hint && (
        <span className="rail-hint" aria-hidden="true" style={{ "--x": `${hint.x}px`, "--y": `${hint.y}px` } as CSSProperties}>
          {hint.name}
        </span>
      )}
      <div className="rail-foot">
        {cardsHere && (
          <Suspense fallback={null}>
            <RailCards />
          </Suspense>
        )}
        <Suspense fallback={null}>
          <UsageMeter />
        </Suspense>
        <button
          type="button"
          className={cx("rail-gear", nav.page === "settings" && "is-on")}
          aria-label={t("shell.rail.settings")}
          title={t("shell.rail.settings")}
          onClick={() => (nav.page === "settings" ? go({ to: "back" }) : go({ to: "settings" }))}
        >
          <Icon name="gear" size={18} />
        </button>
      </div>
    </nav>
  )
}

function Tile({ tile, on, drop, moving, onClick }: { tile: ChannelTile; on: boolean; drop: boolean; moving: boolean; onClick: () => void }) {
  const label = [
    tile.title,
    tile.muted ? t("shell.rail.tile.muted") : "",
    tile.needsYou ? t("shell.rail.tile.need.you", { count: tile.needsYou }) : "",
    tile.unread ? t("shell.rail.tile.new.messages") : "",
    tile.state === "waiting" ? t("shell.rail.tile.waiting") : "",
  ]
    .filter(Boolean)
    .join(t("shell.rail.tile.sep"))
  return (
    <button
      type="button"
      draggable
      data-code={tile.code}
      className={cx("tile", on && "is-on", tile.state !== "member" && "is-waiting", drop && "is-drop", moving && "is-moving", tile.muted && "is-muted")}
      aria-current={on ? "page" : undefined}
      aria-label={label}
      onClick={onClick}
    >
      <Face tile={tile} />
      <span className="tile-name">{tile.title}</span>
      {tile.needsYou > 0 ? <span className="tile-badge">{tile.needsYou}</span> : tile.unread > 0 && !on ? <span className="tile-dot" /> : null}
    </button>
  )
}

export function Face({ tile }: { tile: ChannelTile }) {
  return tile.icon ? <img src={tile.icon} alt="" /> : <span>{tile.title.slice(0, 1).toUpperCase()}</span>
}
