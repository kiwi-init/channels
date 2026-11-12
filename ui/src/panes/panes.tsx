import "~/styles/panes.css"
import { Suspense, useMemo, useRef, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"

import { cx, IconButton } from "~/kit/bits"
import { Boundary } from "~/kit/boundary"
import type { Channel } from "~/model"
import { between, nickname } from "~/names"
import { ActContext, NavContext, useAct, useNav, type Act, type Nav } from "~/nav"
import { docName, Page } from "~/panes/page"
import { ALONE, boxes, closePane, focusPane, leafOf, MIN_H, MIN_W, paneGo, resizeSplit, useDrag, useLayout, type Box, type Split } from "~/panes/store"
import { useTabs } from "~/shell/top-layout"
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

const pct = (n: number): string => `${n * 100}%`

function usePaneAct(code: string, id: string | null): Act {
  const act = useAct()
  return useMemo(
    () =>
      id === null
        ? act
        : {
            ...act,
            go: (go) => {
              const rest = paneGo(code, id, go)
              if (rest) act.go(rest)
            },
          },
    [act, code, id]
  )
}

function Scope({ code, id, nav, children }: { code: string; id: string | null; nav: Nav; children: ReactNode }) {
  const act = usePaneAct(code, id)
  return (
    <NavContext value={nav}>
      <ActContext value={act}>{children}</ActContext>
    </NavContext>
  )
}

export function FocusScope({ code, children }: { code: string; children: ReactNode }) {
  const layout = useLayout(code)
  const nav = useNav()
  const tabs = useTabs()
  const leaf = tabs ? leafOf(layout.root, layout.focus) : null
  return (
    <Scope code={code} id={leaf?.nav ? leaf.id : null} nav={leaf?.nav ?? nav}>
      {children}
    </Scope>
  )
}

export function Panes({ channel, label, main, place }: { channel: Channel; label?: string; main: ReactNode; place: ReactNode }) {
  const code = channel.code
  const layout = useLayout(code)
  const nav = useNav()
  const tabs = useTabs()
  const host = useRef<HTMLDivElement>(null)
  const root = tabs ? layout.root : ALONE.root
  const { leaves, gaps } = useMemo(() => boxes(root), [root])
  const split = leaves.length > 1
  return (
    <div ref={host} className={cx("panes", split && "is-split")} data-panes={code}>
      {leaves.map(({ leaf, box }) => {
        const Tag = leaf.nav ? "section" : "main"
        const name = leaf.doc ? docName(channel, leaf.doc) : placeName(channel, leaf.nav ?? nav)
        return (
          <Tag
            key={leaf.id}
            className={cx("main pane", split && layout.focus === leaf.id && "is-focus", box.x === 0 && box.y === 0 && "is-corner")}
            data-pane={leaf.id}
            aria-label={leaf.nav ? name : label}
            style={{ left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) }}
            onPointerDownCapture={() => focusPane(code, leaf.id)}
          >
            {split && (
              <header className="pane-head">
                <span className="pane-name">{name}</span>
                {leaf.nav && <IconButton icon="close" label={t("shell.rail.close")} onClick={() => closePane(code, leaf.id)} />}
              </header>
            )}
            {leaf.nav ? (
              <Scope code={code} id={leaf.id} nav={leaf.nav}>
                <Boundary resetKey={`${leaf.nav.tab}\n${leaf.doc ? `${leaf.doc.kind}${leaf.doc.kind === "task" ? leaf.doc.task : leaf.doc.ask}` : ""}`}>
                  <Suspense fallback={null}>{leaf.doc ? <Page channel={channel} doc={leaf.doc} /> : place}</Suspense>
                </Boundary>
              </Scope>
            ) : (
              main
            )}
          </Tag>
        )
      })}
      {gaps.map(({ split: s, box }) => (
        <Gap key={s.id} code={code} split={s} box={box} host={host} />
      ))}
      <DragLayer />
    </div>
  )
}

function Gap({ code, split, box, host }: { code: string; split: Split; box: Box; host: RefObject<HTMLDivElement | null> }) {
  const row = split.dir === "row"
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = host.current
    if (!el || e.button !== 0) return
    e.preventDefault()
    const grip = e.currentTarget
    grip.setPointerCapture(e.pointerId)
    const r = el.getBoundingClientRect()
    const from = row ? r.left + box.x * r.width : r.top + box.y * r.height
    const size = row ? box.w * r.width : box.h * r.height
    const least = Math.min(0.5, (row ? MIN_W : MIN_H) / size)
    const root = document.documentElement
    root.dataset.resizing = row ? "panes-row" : "panes-column"
    const move = (m: PointerEvent) => resizeSplit(code, split.id, Math.min(1 - least, Math.max(least, ((row ? m.clientX : m.clientY) - from) / size)))
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
  const at = row ? box.x + box.w * split.ratio : box.y + box.h * split.ratio
  return (
    <div
      className={cx("pane-gap", row ? "is-row" : "is-column")}
      role="separator"
      aria-orientation={row ? "vertical" : "horizontal"}
      style={row ? { left: pct(at), top: pct(box.y), height: pct(box.h) } : { top: pct(at), left: pct(box.x), width: pct(box.w) }}
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
