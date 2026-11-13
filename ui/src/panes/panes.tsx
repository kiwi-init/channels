import "~/i18n/en/shell-later"
import "~/styles/panes.css"
import { Suspense, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"

import { cx, IconButton } from "~/kit/bits"
import { Boundary } from "~/kit/boundary"
import { keyRan, onCommand, runCommand } from "~/kit/commands"
import { dialogOpen, mod } from "~/kit/keys"
import { later } from "~/kit/later"
import type { Channel } from "~/model"
import { nickname } from "~/names"
import { useAct, useApp, useNav, type Go, type Nav, type Panel } from "~/nav"
import { dropOn, targetAt } from "~/panes/drag"
import { docName } from "~/panes/place"
import { dragOut, panelName, placeName, Scope, VIEW_NAMES } from "~/panes/place"
import {
  ALONE,
  BLANK,
  dockedNow,
  MAIN,
  setCloser,
  MIN_H,
  MIN_W,
  useDrag,
  useLayout,
  type Box,
  type Leaf,
  type Carry,
  type Doc,
  type Len,
  type Page as PanePage,
  type Split,
  homeFrom,
  PANE_DRAG,
  setDrag,
} from "~/panes/store"
import { boxes, closePane, css, fillPane, focusPane, isNone, pixels, resizeSplit, splitAt, without } from "~/panes/ops"
import { useTabs } from "~/shell/top-layout"
import { wordsPlain } from "~/words"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"

const ThreadPanel = later(() => import("~/panels/thread").then((m) => m.ThreadPanel))

const LINK = "a[href^='kiwi-']"

const isAll = (l: Len): boolean => l.p === 1 && l.px === 0 && l.side === 0

function spaced(box: Box): CSSProperties {
  const half = "var(--pane-gap) / 2"
  const whole = "var(--pane-gap)"
  const right = { p: box.x.p + box.w.p, px: box.x.px + box.w.px, side: box.x.side + box.w.side }
  const bottom = { p: box.y.p + box.h.p, px: box.y.px + box.h.px, side: box.y.side + box.h.side }
  const l = isNone(box.x) ? whole : half
  const t = isNone(box.y) ? whole : half
  const r = isAll(right) ? whole : half
  const b = isAll(bottom) ? whole : half
  return {
    left: `calc(${css(box.x)} + ${l})`,
    top: `calc(${css(box.y)} + ${t})`,
    width: `calc(${css(box.w)} - ${l} - ${r})`,
    height: `calc(${css(box.h)} - ${t} - ${b})`,
  }
}

const nameOf = (channel: Channel, doc: Doc): string => (doc.kind === "panel" ? panelName(channel, doc.panel) : docName(channel, doc))

function PanelDoc({ channel, panel }: { channel: Channel; panel: Panel }) {
  if (panel.kind === "thread")
    return (
      <div className="panel is-pane">
        <ThreadPanel channel={channel} seq={panel.seq} focus={panel.focus} />
      </div>
    )
  return <Page channel={channel} view={panel.kind === "task" ? { kind: "task", task: panel.task } : panel} />
}

const Page = later(() => import("~/panes/page").then((m) => m.Page))
const ActivityPage = later(() => import("~/panes/activity").then((m) => m.ActivityPage))
const HomePage = later(() => import("~/panes/home").then((m) => m.HomePage))

function HomeDoc({ only }: { only?: string }) {
  const { app } = useApp()
  const tiles = app.channels.filter((c) => c.state !== "gone" && (!only || c.code === only))
  const home = only ? app.home.filter((h) => h.code === only) : app.home
  return <HomePage tiles={tiles} home={home} />
}

const PICKS: readonly { key: Key; page: PanePage }[] = [
  { key: "panes.now", page: { at: "doc", doc: { kind: "now" } } },
  { key: "panes.activity", page: { at: "doc", doc: { kind: "activity" } } },
  { key: "panes.home", page: { at: "doc", doc: { kind: "home" } } },
  { key: "panes.blank.specs", page: { at: "tab", tab: "specs" } },
  { key: "panes.blank.agents", page: { at: "tab", tab: "agents" } },
  { key: "panes.blank.github", page: { at: "tab", tab: "github" } },
]

function BlankPane({ code, id }: { code: string; id: string }) {
  return (
    <div className="pane-blank">
      <p className="pane-blank-title">{t("panes.blank.title")}</p>
      <p className="pane-blank-hint">{t("panes.blank.hint")}</p>
      <div className="pane-blank-picks">
        {PICKS.map((p) => (
          <button key={p.key} type="button" className="btn is-quiet" onClick={() => fillPane(code, id, { page: p.page })}>
            {t(p.key)}
          </button>
        ))}
      </div>
    </div>
  )
}

function DocView({ channel, id, doc }: { channel: Channel; id: string; doc: Doc }) {
  if (doc.kind === "panel") return <PanelDoc channel={channel} panel={doc.panel} />
  if (doc.kind === "blank") return <BlankPane code={channel.code} id={id} />
  if (doc.kind === "home") return <HomeDoc only={doc.only} />
  if (doc.kind === "activity") return <ActivityPage channel={channel} />
  return <Page channel={channel} view={doc} />
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

const TINY_W = MIN_W * 0.9
const TINY_H = MIN_H

let pointerAt = ""

function useLeaving(leaves: readonly { leaf: Leaf; box: Box }[]): readonly { id: string; style: CSSProperties }[] {
  const [leaving, setLeaving] = useState<readonly { id: string; style: CSSProperties }[]>([])
  const last = useRef(new Map<string, CSSProperties>())
  const timers = useRef(new Set<number>())
  const shape = leaves.map(({ leaf, box }) => `${leaf.id}=${JSON.stringify(box)}`).join(" ")
  useLayoutEffect(() => {
    const now = new Map(
      shape
        .split(" ")
        .filter(Boolean)
        .map((part) => {
          const cut = part.indexOf("=")
          return [part.slice(0, cut), spaced(JSON.parse(part.slice(cut + 1)) as Box)] as const
        })
    )
    const gone = [...last.current].filter(([id]) => !now.has(id)).map(([id, style]) => ({ id, style }))
    last.current = now
    if (!gone.length || matchMedia("(prefers-reduced-motion: reduce)").matches) return
    setLeaving((was) => [...was.filter((x) => !gone.some((g) => g.id === x.id)), ...gone])
    const timer = window.setTimeout(() => {
      timers.current.delete(timer)
      setLeaving((was) => was.filter((x) => !gone.some((g) => g.id === x.id && g.style === x.style)))
    }, 240)
    timers.current.add(timer)
  }, [shape])
  useEffect(() => {
    const all = timers.current
    return () => all.forEach((timer) => window.clearTimeout(timer))
  }, [])
  return leaving
}

function useTiny(host: RefObject<HTMLDivElement | null>, ids: string): ReadonlySet<string> {
  const [tiny, setTiny] = useState<ReadonlySet<string>>(() => new Set())
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const small = new Map<string, boolean>()
    let frame = 0
    const watch = new ResizeObserver((entries) => {
      for (const e of entries) small.set((e.target as HTMLElement).dataset.pane ?? "", e.contentRect.width < TINY_W || e.contentRect.height < TINY_H)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const next = new Set([...small].filter(([id, is]) => is && ids.split(" ").includes(id)).map(([id]) => id))
        setTiny((was) => (was.size === next.size && [...next].every((id) => was.has(id)) ? was : next))
      })
    })
    for (const pane of el.querySelectorAll(":scope > [data-pane]")) watch.observe(pane)
    return () => (watch.disconnect(), cancelAnimationFrame(frame))
  }, [host, ids])
  return tiny
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
  const typing = pick(layout.typing) ?? pick(layout.focus) ?? leaves.find(({ leaf }) => talks(leaf))?.leaf.id ?? MAIN
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
  const hovering = useRef(0)
  const hover = (id: string, e: ReactPointerEvent) => {
    window.clearTimeout(hovering.current)
    const root = document.documentElement
    const here = `${e.clientX},${e.clientY}`
    const still = here === pointerAt
    pointerAt = here
    if (still || e.buttons || leaves.length < 2 || root.hasAttribute("data-dragging") || root.dataset.resizing) return
    hovering.current = window.setTimeout(() => {
      const at = document.activeElement
      const busy = at instanceof HTMLTextAreaElement && at.closest(".compose") && at.value.trim() !== ""
      focusPane(code, id, !busy)
    }, 70)
  }
  useEffect(() => {
    const moved = (e: PointerEvent) => {
      pointerAt = `${e.clientX},${e.clientY}`
    }
    const typed = () => window.clearTimeout(hovering.current)
    window.addEventListener("pointermove", moved, { capture: true, passive: true })
    window.addEventListener("keydown", typed, true)
    return () => {
      window.clearTimeout(hovering.current)
      window.removeEventListener("pointermove", moved, { capture: true })
      window.removeEventListener("keydown", typed, true)
    }
  }, [])
  useEffect(() => {
    const clear = () => setDrag(null)
    window.addEventListener("dragend", clear)
    return () => window.removeEventListener("dragend", clear)
  }, [])
  const tiny = useTiny(host, leaves.map(({ leaf }) => leaf.id).join(" "))
  const [born] = useState(() => new Set(leaves.map(({ leaf }) => leaf.id)))
  const [froms, setFroms] = useState<ReadonlyMap<string, string>>(() => new Map())
  const arrived = leaves.filter(({ leaf }) => !born.has(leaf.id) && !froms.has(leaf.id))
  if (arrived.length) {
    const next = new Map(froms)
    for (const { leaf } of arrived) {
      const parent = gaps.find(({ split }) => split.a.id === leaf.id || split.b.id === leaf.id)?.split
      next.set(leaf.id, !parent ? "" : parent.dir === "row" ? (parent.b.id === leaf.id ? "right" : "left") : parent.b.id === leaf.id ? "bottom" : "top")
    }
    setFroms(next)
  }
  const leaving = useLeaving(leaves)
  useEffect(() => {
    const now = () => live.current
    const focused = () => now().leaves.find(({ leaf }) => leaf.id === now().focus)?.leaf ?? now().leaves[0]?.leaf
    setCloser(() => {
      const leaf = focused()
      return !!leaf && now().leaves.length > 1 && now().close(leaf.id)
    })
    const splitOut = (want: "right" | "bottom") => {
      const leaf = focused()
      const r = leaf && host.current?.querySelector(`[data-pane="${leaf.id}"]`)?.getBoundingClientRect()
      if (!leaf || !r) return
      const fits = (edge: "right" | "bottom") => (edge === "right" ? r.width / 2 >= MIN_W : r.height / 2 >= MIN_H)
      const edge = fits(want) ? want : fits(want === "right" ? "bottom" : "right") ? (want === "right" ? "bottom" : "right") : null
      if (edge) splitAt(code, leaf.id, edge, BLANK)
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
    <div
      ref={host}
      className={cx("panes", split && "is-split")}
      data-panes={code}
      onDragOver={(e) => {
        if (!tabs || !e.dataTransfer.types.includes(PANE_DRAG)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
        const carry = { page: BLANK }
        setDrag({ carry, label: "", x: e.clientX, y: e.clientY, target: targetAt(e.clientX, e.clientY, carry) })
      }}
      onDragLeave={(e) => {
        if (!host.current?.contains(e.relatedTarget as globalThis.Node | null)) setDrag(null)
      }}
      onDrop={(e) => {
        setDrag(null)
        const page = homeFrom(e.dataTransfer.getData(PANE_DRAG))
        const target = page && targetAt(e.clientX, e.clientY, { page })
        if (!page || !target) return
        e.preventDefault()
        dropOn(target, { page })
      }}
    >
      <i ref={probe} className="panes-probe" aria-hidden="true" />
      {leaving.map(({ id, style }) => (
        <i key={`gone-${id}`} className="pane-gone" style={style} aria-hidden="true" />
      ))}
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
              !born.has(leaf.id) && "is-new",
              tiny.has(leaf.id) && "is-tiny",
              leaf.doc?.kind === "blank" && "is-blank"
            )}
            data-pane={leaf.id}
            data-from={froms.get(leaf.id) || undefined}
            aria-label={leaf.nav ? name : label}
            style={spaced(box)}
            onPointerDownCapture={() => focusPane(code, leaf.id)}
            onPointerEnter={(e) => hover(leaf.id, e)}
            onPointerLeave={() => window.clearTimeout(hovering.current)}
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
                  <Suspense fallback={null}>{leaf.doc ? <DocView channel={channel} id={leaf.id} doc={leaf.doc} /> : place}</Suspense>
                </Boundary>
              ) : (
                main
              )}
            </Scope>
            {split && <i className="pane-dim" aria-hidden="true" />}
            {tiny.has(leaf.id) && (
              <button type="button" className="pane-tiny" onClick={() => focusPane(code, leaf.id)}>
                {name}
              </button>
            )}
            {leaves.length > 1 && !(plain && !leaf.nav) && (
              <div className="pane-tools">
                <button type="button" className="icon-btn pane-grip" aria-label={t("panes.move")} title={t("panes.move")} {...dragOut({ pane: leaf.id }, name)} />
                {(leaf.nav || heir) && !(leaf.doc?.kind === "panel" && leaf.doc.panel.kind === "thread") && (
                  <IconButton icon="close" label={t("shell.rail.close")} onClick={() => void close(leaf.id)} />
                )}
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
      {box && <div className={cx("pane-drop", drag.target?.fill && "is-fill")} style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
      {drag.label && (
        <div className="pane-ghost" style={{ left: drag.x, top: drag.y }}>
          {drag.label}
        </div>
      )}
    </>,
    document.body
  )
}
