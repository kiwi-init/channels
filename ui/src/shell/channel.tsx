import { useEffect, useState, type CSSProperties } from "react"

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
import { usePanelWidth } from "~/shell/panel-width"
import { Sidebar } from "~/shell/sidebar"
import { Waiting } from "~/start/waiting"
import { Board, openTasks } from "~/tasks/board"
import { between, nickname } from "~/names"

export function ChannelScreen({ channel }: { channel: Channel }) {
  const { nav, go } = useApp()
  const panel = usePanelWidth()
  const [jump, setJump] = useState<Jump | null>(null)
  const [focusAsk, setFocusAsk] = useState(0)
  if (jump && (nav.tab !== "chat" || !sameWhere(jump.m.where, nav.where))) setJump(null)
  const [searching, setSearching] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const offline = useLate(channel.connection !== "live", 1000)
  const [seen, setSeen] = useState(nav.where)
  if (seen !== nav.where) {
    setSeen(nav.where)
    setDrawer(false)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && nav.panel && !document.querySelector("dialog[open]")) go({ to: "panel", panel: null })
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault()
        setSearching(true)
        setFocusAsk((n) => n + 1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [nav.panel, go])

  if (channel.waiting) return <Waiting channel={channel} />

  const needs = openAsks(channel).length
  const tasks = openTasks(channel).length
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
    <div className={cx("chan", nav.panel && "has-panel", drawer && "is-drawer")} style={{ "--panel-w": `${panel.width}px` } as CSSProperties}>
      <header className="top">
        <button type="button" className="icon-btn top-drawer" aria-label={news ? "Rooms and people, new messages" : "Rooms and people"} aria-pressed={drawer} onClick={() => setDrawer(!drawer)}>
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
            Tasks <Count n={tasks} />
          </button>
          {(needs > 0 || nav.tab === "needs") && (
            <button type="button" className="is-needs" aria-pressed={nav.tab === "needs"} onClick={() => go({ to: "tab", tab: "needs" })}>
              Needs you <Count n={needs} loud />
            </button>
          )}
        </nav>
        <div className="top-tools">
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
        </div>
      </header>
      <Sidebar channel={channel} />
      <main className="main">
        <Boundary resetKey={nav.tab}>
          {nav.tab === "tasks" ? <Board channel={channel} /> : nav.tab === "needs" ? <NeedsYou channel={channel} onJump={setJump} /> : <Conversation channel={channel} jump={jump} />}
        </Boundary>
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
