import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react"

import { Conversation } from "~/chat/conversation"
import { SearchBox, type Jump } from "~/chat/search-box"
import { cx, Count, IconButton, useLate } from "~/kit/bits"
import { Boundary } from "~/kit/boundary"
import { Icon } from "~/kit/icons"
import type { Channel } from "~/model"
import { drawerNews } from "~/live/notify"
import { NeedsYou, openAsks } from "~/needs/needs"
import { sameWhere, useApp } from "~/nav"
import { ChannelPanel } from "~/panels/channel-panel"
import { InvitePanel } from "~/panels/invite"
import { AddAgentPanel } from "~/panels/add-agent"
import { PersonPanel } from "~/panels/person"
import { TaskPanel } from "~/panels/task"
import { ThreadPanel } from "~/panels/thread"
import { SIDEBAR_KEYS, useSidebarHidden } from "@/lib/sidebar-hidden"
import { usePanelWidth } from "~/shell/panel-width"
import { isSideKey, setDrawer, toggleSide, useDrawer } from "~/shell/side"
import { Sidebar } from "~/shell/sidebar"
import { Waiting } from "~/start/waiting"
import { Board, openTasks } from "~/tasks/board"
import { Lanes } from "~/tasks/lanes"
import { headerLine } from "~/now"
import { between, nickname } from "~/names"

const TermDrawer = lazy(() => import("~/term/drawer"))

export function ChannelScreen({ channel }: { channel: Channel }) {
  const { nav, go } = useApp()
  const hidden = useSidebarHidden()
  const panel = usePanelWidth(hidden)
  const [jump, setJump] = useState<Jump | null>(null)
  const [focusAsk, setFocusAsk] = useState(0)
  if (jump && (nav.tab !== "chat" || !sameWhere(jump.m.where, nav.where))) setJump(null)
  const [searching, setSearching] = useState(false)
  const drawer = useDrawer()
  const offline = useLate(channel.connection !== "live", 1000)
  useEffect(() => {
    setDrawer(false)
    return () => setDrawer(false)
  }, [nav.where])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSideKey(e)) {
        e.preventDefault()
        toggleSide()
      }
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) {
        if (drawer) setDrawer(false)
        else if (nav.panel) go({ to: "panel", panel: null })
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault()
        setSearching(true)
        setFocusAsk((n) => n + 1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [nav.panel, go, drawer])

  if (channel.waiting) return <Waiting channel={channel} />

  const needs = openAsks(channel).length
  const tasks = openTasks(channel).length
  const agents = channel.people.some((p) => p.kind === "agent" && !p.left)
  const line = channel.loading ? [] : headerLine(channel, needs)
  const here =
    nav.where.kind === "room"
      ? `# ${channel.rooms.find((r) => r.id === (nav.where as { room: string }).room)?.name ?? "general"}`
      : nav.where.kind === "dm"
        ? `@ ${nickname(channel, nav.where.with)}`
        : nav.where.kind === "theirs"
          ? between(channel, nav.where.between)
          : `T${nav.where.task}`

  const news = drawerNews(channel)

  return (
    <div className={cx("chan", nav.panel && "has-panel", drawer && "is-drawer", hidden && "is-bare")} style={{ "--panel-w": `${panel.width}px` } as CSSProperties}>
      <header className="top">
        <button
          type="button"
          className="icon-btn top-drawer"
          aria-label={`Rooms and people${news ? ", new messages" : ""} (${SIDEBAR_KEYS})`}
          title={`Show or hide rooms and people (${SIDEBAR_KEYS})`}
          aria-pressed={drawer}
          onClick={toggleSide}
        >
          <Icon name="sidebar" />
          {news && <span className={cx("top-drawer-dot", news === "loud" && "is-loud")} />}
        </button>
        <div className="top-title">
          <button
            type="button"
            className="top-chan"
            aria-pressed={nav.panel?.kind === "channel"}
            onClick={() => go({ to: "panel", panel: nav.panel?.kind === "channel" ? null : { kind: "channel" } })}
            aria-label={`${channel.title}: channel settings`}
            title="Channel settings"
          >
            <span className="top-name">{channel.title}</span>
            <Icon name="down" size={14} />
          </button>
        </div>
        <nav className="tabs" aria-label="Views">
          <button type="button" aria-pressed={nav.tab === "chat"} onClick={() => go({ to: "tab", tab: "chat" })}>
            {here}
          </button>
          <button type="button" aria-pressed={nav.tab === "tasks"} onClick={() => go({ to: "tab", tab: "tasks" })}>
            <Icon name="tasks" size={14} />
            Tasks <Count n={tasks} />
          </button>
          {(agents || nav.tab === "agents") && (
            <button type="button" className="is-agents" aria-pressed={nav.tab === "agents"} onClick={() => go({ to: "tab", tab: "agents" })}>
              <Icon name="agent" size={14} />
              Agents
            </button>
          )}
          {(needs > 0 || nav.tab === "needs") && (
            <button type="button" className="is-needs" aria-pressed={nav.tab === "needs"} onClick={() => go({ to: "tab", tab: "needs" })}>
              <Icon name="needs" size={14} />
              Needs you <Count n={needs} loud />
            </button>
          )}
        </nav>
        <div className="top-tools">
          {line.length > 0 && !searching && <span className="top-meta num">{line.join(" · ")}</span>}
          {channel.hold && (
            <span className="top-hold" title={channel.hold.note}>
              paused
            </span>
          )}
          {searching ? (
            <SearchBox channel={channel} focusAsk={focusAsk} onJump={setJump} onClose={() => setSearching(false)} />
          ) : (
            <IconButton icon="search" label="Search this channel (⌘F)" onClick={() => setSearching(true)} />
          )}
          <IconButton icon="terminal" label="Your terminal" pressed={nav.term?.kind === "you"} onClick={() => go({ to: "term", term: nav.term?.kind === "you" ? null : { kind: "you" } })} />
        </div>
      </header>
      <Sidebar channel={channel} />
      <main className="main">
        <Boundary resetKey={nav.tab}>
          {nav.tab === "tasks" ? (
            <Board channel={channel} needs={needs} />
          ) : nav.tab === "agents" ? (
            <Lanes channel={channel} />
          ) : nav.tab === "needs" ? (
            <NeedsYou channel={channel} onJump={setJump} />
          ) : (
            <Conversation channel={channel} jump={jump} />
          )}
        </Boundary>
        {nav.term && (
          <Suspense fallback={null}>
            <TermDrawer key={nav.term.kind === "agent" ? `agent:${nav.term.name}` : "you"} channel={channel} of={nav.term} />
          </Suspense>
        )}
      </main>
      {offline && (
        <p className="conn" role="status">
          <span className="dot is-doing" aria-hidden="true" />
          {channel.connection === "connecting" ? "Connecting…" : "Reconnecting…"}
        </p>
      )}
      {nav.panel && (
        <aside className="panel" aria-label="Details">
          <div
            className="panel-grip"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the panel"
            aria-valuemin={panel.min}
            aria-valuemax={panel.max}
            aria-valuenow={panel.width}
            tabIndex={0}
            title="Drag to resize · double-click to reset"
            {...panel.grip}
          />
          <Boundary panel resetKey={JSON.stringify(nav.panel)}>
            {nav.panel.kind === "thread" ? (
              <ThreadPanel channel={channel} seq={nav.panel.seq} />
            ) : nav.panel.kind === "task" ? (
              <TaskPanel channel={channel} id={nav.panel.task} />
            ) : nav.panel.kind === "person" ? (
              <PersonPanel channel={channel} name={nav.panel.name} />
            ) : nav.panel.kind === "channel" ? (
              <ChannelPanel channel={channel} />
            ) : nav.panel.kind === "invite" ? (
              <InvitePanel channel={channel} />
            ) : (
              <AddAgentPanel channel={channel} />
            )}
          </Boundary>
        </aside>
      )}
    </div>
  )
}
