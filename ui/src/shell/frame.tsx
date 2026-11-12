import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"

import { useSidebarHidden } from "@kiwi/app/sidebar-hidden.ts"
import { cx, IconButton } from "~/kit/bits"
import { keyRan, onCommand } from "~/kit/commands"
import { Icon } from "~/kit/icons"
import { dialogOpen, keysHint } from "~/kit/keys"
import { useGo, useNav } from "~/nav"
import { isSideKey, setDrawer, toggleSide, useDrawer } from "~/shell/side"
import { useSideWidth } from "~/shell/side-width"
import { useTabs } from "~/shell/top-layout"
import { t } from "~/i18n/i18n"

const PEEK_SLACK = 24
const SIDE_MOVE_MS = 320

type FrameProps = {
  className?: string | false | null
  news?: "loud" | "quiet" | null
  lead?: ReactNode
  title?: string
  tools?: ReactNode
  side: ReactNode
  children: ReactNode
}

export function Frame({ className, news = null, lead, title, tools, side, children }: FrameProps) {
  const nav = useNav()
  const hidden = useSidebarHidden()
  const tabs = useTabs()
  const width = useSideWidth()
  const drawer = useDrawer()
  const toggles = !lead
  const [peek, setPeek] = useState(false)
  if (!hidden && peek) setPeek(false)
  const peeking = hidden && peek
  useEffect(() => {
    if (!peeking) return
    const onMove = (e: MouseEvent) => {
      const edge = document.querySelector(".side")?.getBoundingClientRect().right ?? 0
      if (e.clientX > edge + PEEK_SLACK) setPeek(false)
    }
    window.addEventListener("mousemove", onMove)
    return () => window.removeEventListener("mousemove", onMove)
  }, [peeking])
  useLayoutEffect(() => {
    const root = document.documentElement
    root.toggleAttribute("data-bare", hidden)
    root.toggleAttribute("data-peek", peeking)
    return () => {
      for (const name of ["data-bare", "data-peek"]) root.removeAttribute(name)
    }
  }, [hidden, peeking])
  const wasHidden = useRef(hidden)
  useLayoutEffect(() => {
    if (wasHidden.current === hidden) return
    wasHidden.current = hidden
    const root = document.documentElement
    root.dataset.sideMove = hidden ? "out" : "in"
    const timer = window.setTimeout(() => delete root.dataset.sideMove, SIDE_MOVE_MS)
    return () => {
      window.clearTimeout(timer)
      delete root.dataset.sideMove
    }
  }, [hidden])
  useEffect(() => {
    setDrawer(false)
    return () => setDrawer(false)
  }, [nav.page, nav.channel, nav.where, nav.section])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSideKey(e) && toggles) {
        e.preventDefault()
        keyRan("sidebar")
        toggleSide()
      }
      if (e.key === "Escape" && !e.defaultPrevented && !dialogOpen() && drawer) setDrawer(false)
    }
    const stop = onCommand((c) => {
      if (c === "sidebar" && toggles) toggleSide()
    })
    window.addEventListener("keydown", onKey)
    return () => {
      stop()
      window.removeEventListener("keydown", onKey)
    }
  }, [drawer, toggles])

  return (
    <div className={cx("chan", className, drawer && "is-drawer", hidden && "is-bare", peeking && "is-peek")}>
      {hidden && !peek && <div className="side-edge" onMouseEnter={() => setPeek(true)} />}
      {!hidden && (
        <div
          className="side-grip"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("shell.channel.resize.side")}
          aria-valuemin={width.min}
          aria-valuemax={width.max}
          aria-valuenow={width.width}
          tabIndex={0}
          title={t("shell.channel.resize.title")}
          {...width.grip}
        />
      )}
      <header className="top">
        <div className="top-lead">
          {lead ?? (
            <button
              type="button"
              className="icon-btn top-drawer"
              aria-label={t(news ? "shell.channel.drawer.label.news" : "shell.channel.drawer.label", { keys: keysHint("\\") })}
              title={t("shell.channel.drawer.title", { keys: keysHint("\\") })}
              aria-pressed={drawer}
              onClick={toggleSide}
            >
              <Icon name="sidebar" />
              {news && <span className={cx("top-drawer-dot", news === "loud" && "is-loud")} />}
            </button>
          )}
        </div>
        {!tabs && title && <h1 className="top-here">{title}</h1>}
        {tools ?? <JumpTools />}
      </header>
      {side}
      {children}
    </div>
  )
}

function JumpTools() {
  const go = useGo()
  return (
    <div className="top-tools">
      <IconButton icon="search" label={t("palette.palette.jump.to")} onClick={() => go({ to: "dialog", dialog: "palette" })} />
    </div>
  )
}
