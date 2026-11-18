import { Suspense, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent } from "react"
import { createPortal } from "react-dom"

import { nextWithNews } from "@kiwi/channel/news.ts"
import { cx } from "~/kit/bits"
import { later } from "~/kit/later"
import { Icon } from "~/kit/icons"
import type { ChannelTile } from "~/model"
import { channelOf, onCommand } from "~/kit/commands"
import { inText } from "~/kit/keys"
import { useNav, useGo, useActions, useTiles, useAppPrefs, useOpenToType } from "~/nav"
import { useWindowMaximized } from "~/live/window-state"
import { openMenu } from "~/kit/menu-open"
import { inOrder, keepOrder, railItems, type Aim, type DropTarget, type Moving, type RailItem, type Slot } from "~/shell/rail-items"
import { useTabs } from "~/shell/top-layout"
import { t } from "~/i18n/i18n"
import { useSidebarHidden } from "@kiwi/app/sidebar-hidden.ts"

const FolderTile = later(() => import("~/shell/rail-folder").then((m) => m.default))
const UsageMeter = later(() => import("~/usage/meter").then((m) => m.UsageMeter))
const RailCards = later(() => import("~/shell/updates").then((m) => m.RailCards))

const DRAG = "application/x-kiwi-channel"
const DRAG_FOLDER = "application/x-kiwi-folder"

const spot = (e: { target: EventTarget }): DropTarget => {
  const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-code],[data-folder]") : null
  const code = el?.dataset["code"]
  const folder = el?.dataset["folder"]
  return code ? { kind: "channel", code } : folder ? { kind: "folder", id: folder } : { kind: "rail" }
}
const keyOf = (target: DropTarget): string => (target.kind === "channel" ? `c:${target.code}` : target.kind === "folder" ? `f:${target.id}` : "rail")

const CUT_NAME_EMS = 3

function fitTabs(strip: HTMLElement) {
  strip.setAttribute("data-fit", "roomy")
  if (strip.scrollWidth <= strip.clientWidth + 1) return
  strip.setAttribute("data-fit", "tight")
  for (const name of strip.querySelectorAll<HTMLElement>(".tile[data-code] > .tile-name")) {
    if (name.scrollWidth <= name.clientWidth) continue
    if (name.clientWidth >= CUT_NAME_EMS * Number.parseFloat(getComputedStyle(name).fontSize)) continue
    strip.setAttribute("data-fit", "icons")
    return
  }
}

function useSteadyTiles(tiles: readonly ChannelTile[]): ChannelTile[] {
  const [order, setOrder] = useState<readonly string[]>(() => tiles.map((c) => c.code))
  const next = keepOrder(
    order,
    tiles.map((c) => c.code)
  )
  if (next.length !== order.length || next.some((code, i) => code !== order[i])) setOrder(next)
  return inOrder(tiles, next)
}

const EDGE = 0.25

const isItem = (item: RailItem, moving: Moving): boolean =>
  moving.kind === "channel" ? item.kind === "channel" && item.tile.code === moving.code : item.kind === "folder" && item.folder.id === moving.id

const slotAt = (items: readonly RailItem[], at: number): Slot => {
  const item = items[at]
  return !item ? { kind: "end" } : item.kind === "channel" ? { kind: "channel", code: item.tile.code } : { kind: "folder", id: item.folder.id }
}

type Aimed = { aim: Aim | null; at: number | null }

function itemBox(list: HTMLElement, item: RailItem): { left: number; width: number } | null {
  const find = (attr: string, value: string) => list.querySelector<HTMLElement>(`[${attr}="${CSS.escape(value)}"]`)
  const els = item.kind === "channel" ? [find("data-code", item.tile.code)] : [find("data-folder", item.folder.id), ...(item.folder.open ? item.tiles.map((c) => find("data-code", c.code)) : [])]
  const boxes = els.flatMap((el) => (el ? [el.getBoundingClientRect()] : []))
  if (!boxes.length) return null
  const left = Math.min(...boxes.map((b) => b.left))
  return { left, width: Math.max(...boxes.map((b) => b.right)) - left }
}

function aimAt(e: { target: EventTarget; clientX: number }, moving: Moving, items: readonly RailItem[], list: HTMLElement): Aimed {
  const own = items.findIndex((item) => isItem(item, moving))
  const slot = (at: number): Aimed => (own >= 0 && (at === own || at === own + 1) ? { aim: null, at: null } : { aim: { kind: "slot", before: slotAt(items, at) }, at })
  const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-code],[data-folder]") : null
  const folderId = el?.dataset["folder"] ?? el?.closest<HTMLElement>("li.rail-folder")?.querySelector<HTMLElement>("[data-folder]")?.dataset["folder"]
  const code = el?.dataset["code"]
  const at = el ? items.findIndex((item) => (folderId ? item.kind === "folder" && item.folder.id === folderId : item.kind === "channel" && item.tile.code === code)) : -1
  const item = items[at]
  if (!el || !item) {
    const next = items.findIndex((it) => {
      const box = itemBox(list, it)
      return !!box && box.left + box.width / 2 > e.clientX
    })
    return slot(next < 0 ? items.length : next)
  }
  const box = (item.kind === "folder" && item.folder.open && moving.kind === "folder" ? itemBox(list, item) : null) ?? el.getBoundingClientRect()
  const f = (e.clientX - box.left) / Math.max(box.width, 1)
  if (moving.kind === "folder") return item.kind === "folder" && item.folder.id === moving.id ? { aim: null, at: null } : slot(f < 0.5 ? at : at + 1)
  if (item.kind === "channel")
    return f < EDGE
      ? slot(at)
      : f > 1 - EDGE
        ? slot(at + 1)
        : item.tile.code === moving.code
          ? { aim: null, at: null }
          : { aim: { kind: "join", target: { kind: "channel", code: item.tile.code } }, at: null }
  const child = !!code
  const last = child && item.tiles.at(-1)?.code === code
  if (!child && f < EDGE) return slot(at)
  if (!child && !item.folder.open && f > 1 - EDGE) return slot(at + 1)
  if (last && f > 1 - EDGE) return slot(at + 1)
  if (child && code === moving.code) return { aim: null, at: null }
  return { aim: { kind: "join", target: child && code ? { kind: "channel", code } : { kind: "folder", id: item.folder.id } }, at: null }
}

export function Rail() {
  const nav = useNav()
  const go = useGo()
  const enter = useOpenToType()
  const actions = useActions()
  const prefs = useAppPrefs()
  const steady = useSteadyTiles(useTiles())
  const tiles = inOrder(
    steady,
    keepOrder(
      prefs.tabOrder,
      steady.map((c) => c.code)
    )
  )
  const onChannel = nav.page === "channel"
  const home = onChannel && nav.channel === null
  const sidebarHidden = useSidebarHidden()
  const tabs = useTabs()
  useLayoutEffect(() => {
    const root = document.documentElement
    root.toggleAttribute("data-tabs", tabs)
    return () => root.removeAttribute("data-tabs")
  }, [tabs])
  const cardsHere = sidebarHidden || (home && !tabs)
  const on = onChannel ? nav.channel : null
  const folders = prefs.folders
  const items = railItems(tiles, folders)
  const ordered = items.flatMap((i) => (i.kind === "channel" ? [i.tile] : i.tiles))
  const strip = useRef<HTMLElement>(null)
  const shown = items.map((i) => (i.kind === "channel" ? i.tile.title : `${i.folder.id}:${i.folder.open}:${i.tiles.map((c) => c.title).join()}`)).join("|")
  useLayoutEffect(() => {
    const el = strip.current
    if (!el || !tabs) return
    const fit = () => fitTabs(el)
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(el)
    return () => {
      watch.disconnect()
      el.removeAttribute("data-fit")
    }
  }, [tabs, shown])
  const [over, setOver] = useState<string | null>(null)
  const [moving, setMoving] = useState<Moving | null>(null)
  const [aimed, setAimed] = useState<Aimed>({ aim: null, at: null })
  const [gap, setGap] = useState(0)
  const list = useRef<HTMLUListElement>(null)
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
    if (next) enter(next.code)
  })
  const pick = useEffectEvent((n: number | null) => {
    const tile = n === null ? undefined : ordered[n - 1]
    if (tile) enter(tile.code)
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
    if (!tabs) {
      const target = spot(e)
      return setOver(moving.kind === "channel" && target.kind === "channel" && target.code === moving.code ? null : keyOf(target))
    }
    if (!list.current || (e.target instanceof Element && e.target.closest(".rail-gap"))) return
    const next = aimAt(e, moving, items, list.current)
    const join = next.aim?.kind === "join" ? next.aim.target : null
    setOver(join ? (join.kind === "channel" ? `c:${join.code}` : `f:${join.id}`) : null)
    if (JSON.stringify(next) !== JSON.stringify(aimed)) setAimed(next)
  }
  const endDrag = () => {
    setMoving(null)
    setOver(null)
    setAimed({ aim: null, at: null })
  }
  const dropTabs = (aim: Aim | null, from: Moving) => {
    if (!aim) return
    const order = tiles.map((c) => c.code)
    void import("~/shell/folders").then((f) => {
      const next = f.dropResult({ order, folders }, from, aim, f.newFolderId)
      if (!next) return
      setFresh(next.folders.find((x) => !folders.some((y) => y.id === x.id))?.id ?? null)
      actions.setPrefs({ folders: next.folders, tabOrder: next.order })
    })
  }
  const gapAt = (at: number) => (moving && aimed.at === at ? <li key="gap" className="rail-gap" aria-hidden="true" style={{ "--gap": `${gap}px` } as CSSProperties} /> : null)
  const tile = (c: ChannelTile) => (
    <Tile key={c.code} tile={c} on={on === c.code} drop={over === `c:${c.code}`} moving={moving?.kind === "channel" && moving.code === c.code} onClick={() => enter(c.code)} />
  )
  return (
    <nav ref={strip} className="rail" aria-label={t("shell.rail.channels")}>
      {document.documentElement.dataset["wm"] === "floating" && createPortal(<WindowControls control={actions.windowControl} />, document.body)}
      <ul
        ref={list}
        className={cx("rail-list", moving && "is-moving", over === "rail" && "is-drop")}
        onMouseOver={point}
        onMouseLeave={() => setHint(null)}
        onMouseDown={() => setHint(null)}
        onScroll={() => setHint(null)}
        onDragStart={(e) => {
          const target = spot(e)
          if (target.kind === "rail" || (target.kind === "folder" && !tabs)) return
          const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-code],[data-folder]") : null
          const folder = target.kind === "folder" ? items.find((item) => item.kind === "folder" && item.folder.id === target.id) : undefined
          const width = folder && list.current ? itemBox(list.current, folder)?.width : el?.getBoundingClientRect().width
          e.dataTransfer.setData(target.kind === "channel" ? DRAG : DRAG_FOLDER, target.kind === "channel" ? target.code : target.id)
          e.dataTransfer.effectAllowed = "move"
          setGap(Math.round(width ?? 0))
          setMoving(target.kind === "channel" ? { kind: "channel", code: target.code } : { kind: "folder", id: target.id })
        }}
        onDragEnd={endDrag}
        onDragOver={dragOver}
        onDrop={(e) => {
          const from = moving
          const aim = aimed.aim
          const code = e.dataTransfer.getData(DRAG)
          const target = spot(e)
          endDrag()
          if (!from) return
          e.preventDefault()
          if (tabs) return dropTabs(aim, from)
          if (!code) return
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
        {items.flatMap((item, at) => [
          gapAt(at),
          item.kind === "channel" ? (
            <li key={item.tile.code}>{tile(item.tile)}</li>
          ) : (
            <li key={item.folder.id} className={cx("rail-folder", item.folder.open && "is-open", moving?.kind === "folder" && moving.id === item.folder.id && "is-moving")}>
              <Suspense fallback={<span className="tile is-folder" />}>
                <FolderTile
                  folder={item.folder}
                  tiles={item.tiles}
                  on={on}
                  drop={over === `f:${item.folder.id}`}
                  fresh={fresh === item.folder.id}
                  draggable={tabs}
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
          ),
        ])}
        {gapAt(items.length)}
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

function WindowControls({ control }: { control: (action: "minimize" | "maximize" | "close") => void }) {
  const maximized = useWindowMaximized()
  return (
    <div className="wm-controls">
      <button type="button" className="wm-btn" aria-label={t("shell.rail.minimize.window")} title={t("shell.rail.minimize")} onClick={() => control("minimize")}>
        <Icon name="minus" size={14} />
      </button>
      <button
        type="button"
        className="wm-btn"
        aria-label={maximized ? t("shell.rail.restore.window") : t("shell.rail.maximize.window")}
        title={maximized ? t("shell.rail.restore") : t("shell.rail.maximize")}
        onClick={() => control("maximize")}
      >
        <Icon name={maximized ? "restore" : "expand"} size={14} />
      </button>
      <button type="button" className="wm-btn is-close" aria-label={t("shell.rail.close.window")} title={t("shell.rail.close")} onClick={() => control("close")}>
        <Icon name="close" size={14} />
      </button>
    </div>
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
      <span className="tile-name" data-name={tile.title}>
        {tile.title}
      </span>
      <span className="tile-mark">{tile.needsYou > 0 ? <span className="tile-badge">{tile.needsYou}</span> : tile.unread > 0 && !on ? <span className="tile-dot" /> : null}</span>
    </button>
  )
}

export function Face({ tile }: { tile: ChannelTile }) {
  return tile.icon ? <img src={tile.icon} alt="" /> : <span>{tile.title.slice(0, 1).toUpperCase()}</span>
}
