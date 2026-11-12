import "~/styles/panes.css"
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"

import { cx, IconButton } from "~/kit/bits"
import { Boundary } from "~/kit/boundary"
import { keyRan, onCommand, runCommand } from "~/kit/commands"
import { dialogOpen, mod } from "~/kit/keys"
import { later } from "~/kit/later"
import type { Channel } from "~/model"
import { between, nickname } from "~/names"
import { ActContext, NavContext, useAct, useNav, type Act, type Go, type Nav, type Panel } from "~/nav"
import { dragOut } from "~/panes/drag"
import { docName, Page } from "~/panes/page"
import { PaneContext, type PaneScope } from "~/panes/scope"
import {
  ALONE,
  boxes,
  closePane,
  css,
  dockedNow,
  focusPane,
  isNone,
  leafOf,
  MAIN,
  pageOf,
  panelGo,
  setCloser,
  splitAt,
  MIN_H,
  MIN_W,
  paneGo,
  pixels,
  resizeSplit,
  showDoc,
  useDrag,
  useLayout,
  without,
  type Box,
  type Leaf,
  type Carry,
  type Doc,
  type Edge,
  type Len,
  type Split,
} from "~/panes/store"
import { useTabs } from "~/shell/top-layout"
import { wordsPlain } from "~/words"
import { t } from "~/i18n/i18n"

const VIEW_NAMES = {
  specs: "shell.channel.specs",
  agents: "shell.channel.agents",
  github: "shell.channel.github",
  needs: "shell.channel.needs.you",
} as const

export function placeName(channel: Channel, nav: Nav): string {
  if (nav.tab !== "chat") return t(VIEW_NAMES[nav.tab])
  const where = nav.where
  if (where.kind === "room") return `# ${channel.rooms.find((r) => r.id === where.room)?.name ?? "general"}`
  if (where.kind === "dm") return `@ ${nickname(channel, where.with)}`
  return where.kind === "theirs" ? between(channel, where.between) : `T${where.task}`
}

const PrPanel = later(() => import("~/github/panel").then((m) => m.PrPanel))
const IssuePanel = later(() => import("~/github/panel").then((m) => m.IssuePanel))
const TaskPanel = later(() => import("~/panels/task").then((m) => m.TaskPanel))
const ThreadPanel = later(() => import("~/panels/thread").then((m) => m.ThreadPanel))

const LINK = "a[href^='kiwi-']"

export function roomiest(code: string): { id: string; edge: Edge } | undefined {
  const panes = [...document.querySelectorAll<HTMLElement>(`[data-panes="${code}"] > [data-pane]`)].map((el) => ({ id: el.dataset.pane ?? "", r: el.getBoundingClientRect() }))
  const best = panes.filter((p) => p.r.width >= 2 * MIN_W || p.r.height >= 2 * MIN_H).sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0]
  if (!best) return undefined
  return { id: best.id, edge: best.r.width >= 2 * MIN_W && best.r.width >= best.r.height * 0.9 ? "right" : "bottom" }
}

function panelName(channel: Channel, panel: Panel): string {
  if (panel.kind === "task") return docName(channel, { kind: "task", task: panel.task })
  if (panel.kind === "thread") return t("panes.thread")
  const item = panel.kind === "pr" ? channel.prs?.find((p) => p.repo === panel.repo && p.number === panel.number) : channel.issues?.find((i) => i.repo === panel.repo && i.number === panel.number)
  return `#${panel.number}${item ? ` ${item.title}` : ""}`
}

const nameOf = (channel: Channel, doc: Doc): string => (doc.kind === "panel" ? panelName(channel, doc.panel) : docName(channel, doc))

function PanelDoc({ channel, panel }: { channel: Channel; panel: Panel }) {
  return (
    <div className="panel is-pane">
      {panel.kind === "thread" ? (
        <ThreadPanel channel={channel} seq={panel.seq} focus={panel.focus} />
      ) : panel.kind === "task" ? (
        <TaskPanel channel={channel} id={panel.task} />
      ) : panel.kind === "pr" ? (
        <PrPanel channel={channel} repo={panel.repo} number={panel.number} />
      ) : (
        <IssuePanel channel={channel} repo={panel.repo} number={panel.number} />
      )}
    </div>
  )
}

function carried(channel: Channel, href: string): { carry: Carry; label: string } | null {
  const cut = href.indexOf(":")
  const kind = href.slice(0, cut)
  const rest = href.slice(cut + 1)
  if (kind === "kiwi-task") {
    const doc: Doc = { kind: "task", task: Number(rest) }
    return { carry: { page: { at: "doc", doc } }, label: docName(channel, doc) }
  }
  if (kind === "kiwi-msg") {
    const spec = channel.specs?.find((s) => s.ask === Number(rest))
    return spec ? { carry: { page: { at: "spec", ask: spec.ask } }, label: wordsPlain(spec.title, channel.nicknames) } : null
  }
  if (kind === "kiwi-mention") {
    const name = decodeURIComponent(rest)
    return { carry: { page: { at: "where", where: { kind: "dm", with: name } } }, label: `@ ${nickname(channel, name)}` }
  }
  if (kind !== "kiwi-page") return null
  if (rest === "now") return { carry: { page: { at: "doc", doc: { kind: "now" } } }, label: t("panes.now") }
  return rest === "specs" || rest === "agents" || rest === "github" || rest === "needs" ? { carry: { page: { at: "tab", tab: rest } }, label: t(VIEW_NAMES[rest]) } : null
}

function goTo(nav: Nav): Go {
  if (nav.tab === "chat") return { to: "where", where: nav.where }
  if (nav.tab === "specs") return { to: "spec", ask: nav.spec ?? null, part: nav.part }
  if (nav.tab === "github" && nav.github) return { to: "github", view: nav.github }
  return { to: "tab", tab: nav.tab }
}

function Scope({ code, id, nav, doc, shown, typing = true, children }: { code: string; id: string | null; nav: Nav; doc: Doc | null; shown: boolean; typing?: boolean; children: ReactNode }) {
  const act = useAct()
  const tabs = useTabs()
  const scoped = useMemo(
    (): Act => ({
      ...act,
      go: (go) => {
        if (go.to === "panel" && tabs) return panelGo(code, id ?? MAIN, go.panel, go.panel ? roomiest(code) : undefined)
        const rest = id === null ? go : paneGo(code, id, go)
        if (rest) act.go(rest)
      },
    }),
    [act, code, id, tabs]
  )
  const pane = useMemo((): PaneScope => ({ doc, show: (next) => showDoc(code, id, next, shown), typing }), [code, id, doc, shown, typing])
  return (
    <NavContext value={nav}>
      <ActContext value={scoped}>
        <PaneContext value={pane}>{children}</PaneContext>
      </ActContext>
    </NavContext>
  )
}

export function FocusScope({ code, now, children }: { code: string; now: boolean; children: ReactNode }) {
  const layout = useLayout(code)
  const nav = useNav()
  const tabs = useTabs()
  const dock = dockedNow(layout.root)
  const shown = !dock || now
  const focus = tabs ? leafOf(layout.root, layout.focus) : null
  const leaf = focus?.nav && (shown || focus.id !== dock?.id) ? focus : null
  return (
    <Scope code={code} id={leaf?.id ?? null} nav={leaf?.nav ?? nav} doc={leaf?.doc ?? null} shown={shown}>
      {children}
    </Scope>
  )
}

export function Panes({ channel, label, main, place, now }: { channel: Channel; label?: string; main: ReactNode; place: ReactNode; now: boolean }) {
  const code = channel.code
  const layout = useLayout(code)
  const nav = useNav()
  const tabs = useTabs()
  const { go } = useAct()
  const host = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLElement>(null)
  const dock = dockedNow(layout.root)
  const shown = !dock || now
  const root = !tabs ? ALONE.root : dock && !now ? without(layout.root, dock.id) : layout.root
  const { leaves, gaps } = boxes(root)
  const plain = leaves.length === 2 && !!dock && shown
  const split = leaves.length > 1 && !plain
  const heir = leaves.find(({ leaf }) => leaf.nav && !leaf.doc)?.leaf
  const talks = (leaf: Leaf): boolean => (leaf.nav ? leaf.nav.tab === "chat" && !leaf.doc : nav.tab === "chat")
  const pick = (id: string | undefined) => leaves.find(({ leaf }) => leaf.id === id && talks(leaf))?.leaf.id
  const typing = pick(layout.focus) ?? pick(layout.typing) ?? leaves.find(({ leaf }) => talks(leaf))?.leaf.id ?? MAIN
  const close = (id: string): boolean => {
    if (id !== MAIN) return (closePane(code, id), true)
    if (!heir?.nav) return false
    go(goTo(heir.nav))
    closePane(code, heir.id)
    return true
  }
  const live = useRef({ leaves, close, focus: layout.focus, nav })
  useLayoutEffect(() => {
    live.current = { leaves, close, focus: layout.focus, nav }
  })
  const [born] = useState(() => new Set(leaves.map(({ leaf }) => leaf.id)))
  useEffect(() => {
    const now = () => live.current
    const focused = () => now().leaves.find(({ leaf }) => leaf.id === now().focus)?.leaf ?? now().leaves[0]?.leaf
    setCloser(() => {
      const leaf = focused()
      return !!leaf && now().leaves.length > 1 && now().close(leaf.id)
    })
    const splitOut = (edge: "right" | "bottom") => {
      const leaf = focused()
      if (leaf) splitAt(code, leaf.id, edge, pageOf(leaf, now().nav))
    }
    const step = (dx: number, dy: number) => {
      const from = host.current?.querySelector<HTMLElement>(`[data-pane="${now().focus}"]`)?.getBoundingClientRect()
      if (!from) return
      let best: { id: string; d: number } | null = null
      for (const el of host.current?.querySelectorAll<HTMLElement>("[data-pane]") ?? []) {
        const r = el.getBoundingClientRect()
        const ahead = dx ? (r.left + r.right - from.left - from.right) * dx : (r.top + r.bottom - from.top - from.bottom) * dy
        const overlap = dx ? Math.min(r.bottom, from.bottom) - Math.max(r.top, from.top) : Math.min(r.right, from.right) - Math.max(r.left, from.left)
        if (ahead <= 0 || overlap <= 0 || !el.dataset.pane) continue
        if (!best || ahead < best.d) best = { id: el.dataset.pane, d: ahead }
      }
      if (!best) return
      focusPane(code, best.id)
      host.current?.querySelector<HTMLElement>(`[data-pane="${best.id}"] :is(.compose textarea, .page, .feed)`)?.focus({ preventScroll: true })
    }
    const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const onKey = (e: KeyboardEvent) => {
      if (!mod(e) || dialogOpen()) return
      const key = e.key.toLowerCase()
      const arrow = ARROWS[e.key]
      if (arrow && e.altKey && !e.shiftKey) {
        e.preventDefault()
        step(...arrow)
      } else if (key === "d" && !e.altKey) {
        e.preventDefault()
        const command = e.shiftKey ? "split-down" : "split-right"
        runCommand(command)
        keyRan(command)
      } else if (key === "w" && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        runCommand("close-pane")
        keyRan("close-pane")
      }
    }
    const stop = onCommand((c) => {
      if (c === "split-right") splitOut("right")
      else if (c === "split-down") splitOut("bottom")
    })
    window.addEventListener("keydown", onKey)
    return () => {
      stop()
      setCloser(null)
      window.removeEventListener("keydown", onKey)
    }
  }, [code])
  return (
    <div ref={host} className={cx("panes", split && "is-split")} data-panes={code}>
      <i ref={probe} className="panes-probe" aria-hidden="true" />
      {leaves.map(({ leaf, box }) => {
        const Tag = leaf.nav ? "section" : "main"
        const name = leaf.doc ? nameOf(channel, leaf.doc) : placeName(channel, leaf.nav ?? nav)
        return (
          <Tag
            key={leaf.id}
            className={cx(
              "main pane",
              isNone(box.x) && isNone(box.y) && "is-corner",
              leaf.id === layout.focus && "is-focus",
              split && leaf.id !== typing && "is-quiet",
              !born.has(leaf.id) && "is-new"
            )}
            data-pane={leaf.id}
            aria-label={leaf.nav ? name : label}
            style={{ left: css(box.x), top: css(box.y), width: css(box.w), height: css(box.h) }}
            onPointerDownCapture={() => focusPane(code, leaf.id)}
            onPointerDown={(e) => {
              const href = (e.target as Element).closest?.(LINK)?.getAttribute("href")
              const out = href ? carried(channel, href) : null
              if (out) dragOut(out.carry, out.label).onPointerDown(e)
            }}
            onDragStart={(e) => {
              if ((e.target as Element).closest?.(LINK)) e.preventDefault()
            }}
          >
            <Scope code={code} id={leaf.nav ? leaf.id : null} nav={leaf.nav ?? nav} doc={leaf.doc ?? null} shown={shown} typing={leaf.id === typing}>
              {leaf.nav ? (
                <Boundary resetKey={`${leaf.nav.tab}\n${leaf.doc ? JSON.stringify(leaf.doc) : ""}`}>
                  <Suspense fallback={null}>
                    {leaf.doc?.kind === "panel" ? <PanelDoc channel={channel} panel={leaf.doc.panel} /> : leaf.doc ? <Page channel={channel} view={leaf.doc} /> : place}
                  </Suspense>
                </Boundary>
              ) : (
                main
              )}
            </Scope>
            {split && <i className="pane-dim" aria-hidden="true" />}
            {leaves.length > 1 && !(plain && !leaf.nav) && (
              <div className="pane-tools">
                <button type="button" className="icon-btn pane-grip" aria-label={t("panes.move")} title={t("panes.move")} {...dragOut({ pane: leaf.id }, name)} />
                {(leaf.nav || heir) && leaf.doc?.kind !== "panel" && <IconButton icon="close" label={t("shell.rail.close")} onClick={() => void close(leaf.id)} />}
              </div>
            )}
          </Tag>
        )
      })}
      {gaps.map(({ split, box, at }) => (
        <Gap key={split.id} code={code} split={split} box={box} at={at} host={host} probe={probe} />
      ))}
      <DragLayer />
    </div>
  )
}

function Gap({ code, split, box, at, host, probe }: { code: string; split: Split; box: Box; at: Len; host: RefObject<HTMLDivElement | null>; probe: RefObject<HTMLElement | null> }) {
  const row = split.dir === "row"
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = host.current
    if (!el || e.button !== 0) return
    e.preventDefault()
    const grip = e.currentTarget
    grip.setPointerCapture(e.pointerId)
    const r = el.getBoundingClientRect()
    const side = probe.current?.offsetWidth ?? 0
    const whole = row ? r.width : r.height
    const from = (row ? r.left : r.top) + pixels(row ? box.x : box.y, whole, side)
    const size = pixels(row ? box.w : box.h, whole, side)
    const least = Math.min(size / 2, row ? MIN_W : MIN_H)
    const fix = split.fix
    const root = document.documentElement
    root.dataset.resizing = row ? "panes-row" : "panes-column"
    const move = (m: PointerEvent) => {
      const first = Math.min(size - least, Math.max(least, (row ? m.clientX : m.clientY) - from))
      resizeSplit(code, split.id, fix ? { px: fix.side === "a" ? first : size - first } : { ratio: first / size })
    }
    const end = () => {
      grip.removeEventListener("pointermove", move)
      grip.removeEventListener("pointerup", end)
      grip.removeEventListener("pointercancel", end)
      delete root.dataset.resizing
    }
    grip.addEventListener("pointermove", move)
    grip.addEventListener("pointerup", end)
    grip.addEventListener("pointercancel", end)
  }
  return (
    <div
      className={cx("pane-gap", row ? "is-row" : "is-column", split.fix && "is-dock")}
      role="separator"
      aria-orientation={row ? "vertical" : "horizontal"}
      style={row ? { left: css(at), top: css(box.y), height: css(box.h) } : { top: css(at), left: css(box.x), width: css(box.w) }}
      onPointerDown={down}
    />
  )
}

function DragLayer() {
  const drag = useDrag()
  if (!drag) return null
  const box = drag.target?.box
  return createPortal(
    <>
      {box && <div className="pane-drop" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
      <div className="pane-ghost" style={{ left: drag.x, top: drag.y }}>
        {drag.label}
      </div>
    </>,
    document.body
  )
}
