import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react"

import { Conversation } from "~/chat/conversation"
import type { Jump } from "~/chat/search-box"
import { cx, Count, IconButton, useLate } from "~/kit/bits"
import { useGlide } from "~/kit/glide"
import { Boundary } from "~/kit/boundary"
import { Icon } from "~/kit/icons"
import { later } from "~/kit/later"
import type { Channel } from "~/model"
import { drawerNews } from "~/live/notify"
import { dropMessage, findWanted, useWantedMessage } from "~/live/open-message"
import { openAsks } from "~/needs/open"
import { sameWhere, useApp } from "~/nav"
import { ThreadPanel } from "~/panels/thread"
import { SIDEBAR_KEYS, useSidebarHidden } from "@kiwi/app/sidebar-hidden.ts"
import { usePanelWidth } from "~/shell/panel-width"
import { isSideKey, setDrawer, toggleSide, useDrawer, useTall } from "~/shell/side"
import { Sidebar } from "~/shell/sidebar"
import { useSideways } from "~/kit/sideways"
import { openTasks } from "~/tasks/open"
import { headerLine } from "~/now"
import { between, nickname } from "~/names"

const TermDrawer = lazy(() => import("~/term/drawer"))
const TallPage = lazy(() => import("~/shell/tall"))
const Waiting = later(() => import("~/start/waiting").then((m) => m.Waiting))
const SearchBox = later(() => import("~/chat/search-box").then((m) => m.SearchBox))
const Board = later(() => import("~/tasks/board").then((m) => m.Board))
const Lanes = later(() => import("~/tasks/lanes").then((m) => m.Lanes))
const PullRequests = later(() => import("~/github/lists").then((m) => m.PullRequests))
const Issues = later(() => import("~/github/lists").then((m) => m.Issues))
const PrPanel = later(() => import("~/github/panel").then((m) => m.PrPanel))
const IssuePanel = later(() => import("~/github/panel").then((m) => m.IssuePanel))
const NeedsYou = later(() => import("~/needs/needs").then((m) => m.NeedsYou))
const TaskPanel = later(() => import("~/panels/task").then((m) => m.TaskPanel))
const PersonPanel = later(() => import("~/panels/person").then((m) => m.PersonPanel))
const ChannelPanel = later(() => import("~/panels/channel-panel").then((m) => m.ChannelPanel))
const InvitePanel = later(() => import("~/panels/invite").then((m) => m.InvitePanel))
const AddAgentPanel = later(() => import("~/panels/add-agent").then((m) => m.AddAgentPanel))

export function ChannelScreen({ channel }: { channel: Channel }) {
  const { nav, go } = useApp()
  const hidden = useSidebarHidden()
  const panel = usePanelWidth(hidden)
  const [jump, setJump] = useState<Jump | null>(null)
  const [focusAsk, setFocusAsk] = useState(0)
  if (jump && (nav.tab !== "chat" || !sameWhere(jump.m.where, nav.where))) setJump(null)
  const wanted = useWantedMessage()
  const found = findWanted(wanted, channel.code, channel.messages)
  const target = found.kind === "found" ? found.m : null
  const root = target?.inThread
  const anchor = root === undefined ? target : (channel.messages.find((m) => m.seq === root) ?? target)
  const atAnchor = !!anchor && nav.tab === "chat" && sameWhere(anchor.where, nav.where)
  if (anchor && atAnchor && jump?.m.seq !== anchor.seq) setJump({ m: anchor, terms: [] })
  useEffect(() => {
    if (!wanted) return
    if (found.kind === "missing") return dropMessage(wanted)
    if (!anchor) return
    if (!atAnchor) return go({ to: "where", where: anchor.where })
    if (jump?.m.seq !== anchor.seq) return
    if (root !== undefined) go({ to: "panel", panel: { kind: "thread", seq: root, focus: wanted.seq } })
    dropMessage(wanted)
  }, [wanted, found.kind, anchor, root, atAnchor, jump, go])
  const [searching, setSearching] = useState(false)
  const drawer = useDrawer()
  const tall = useTall()
  const tabsRef = useGlide<HTMLElement>('[aria-pressed="true"]')
  useSideways(tabsRef, nav.tab, '[aria-pressed="true"]')
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
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("dialog[open]")) {
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

  if (channel.waiting)
    return (
      <Suspense fallback={null}>
        <Waiting channel={channel} />
      </Suspense>
    )

  const needs = openAsks(channel).length
  const tasks = openTasks(channel).length
  const agents = channel.people.some((p) => p.kind === "agent" && !p.left)
  const github = channel.repos.length > 0 || !!channel.prs?.length || !!channel.issues?.length
  const openPrs = channel.prs?.filter((p) => p.state === "open" || p.state === "draft") ?? []
  const red = openPrs.some((p) => p.checks === "fail" || !!p.ticks?.failed.length)
  const openIssues = channel.issues?.filter((i) => i.state === "open").length ?? 0
  const line = channel.loading ? [] : headerLine(channel, 0)
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
    <div className={cx("chan", nav.panel && !(tall && nav.tab !== "needs") && "has-panel", drawer && "is-drawer", hidden && "is-bare")} style={{ "--panel-w": `${panel.width}px` } as CSSProperties}>
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
        <nav ref={tabsRef} className="tabs" aria-label="Views">
          <button type="button" aria-pressed={nav.tab === "chat" || (tall && nav.tab !== "needs")} onClick={() => go({ to: "tab", tab: "chat" })}>
            {here}
          </button>
          {!tall && (
            <button type="button" aria-pressed={nav.tab === "tasks"} onClick={() => go({ to: "tab", tab: "tasks" })}>
              <Icon name="tasks" size={14} />
              Tasks <Count n={tasks} />
            </button>
          )}
          {!tall && (agents || nav.tab === "agents") && (
            <button type="button" className="is-agents" aria-pressed={nav.tab === "agents"} onClick={() => go({ to: "tab", tab: "agents" })}>
              <Icon name="agent" size={14} />
              Agents
            </button>
          )}
          {!tall && (github || nav.tab === "prs") && (
            <button type="button" aria-pressed={nav.tab === "prs"} onClick={() => go({ to: "tab", tab: "prs" })} title={red ? "A pull request's checks failed" : undefined}>
              <Icon name="pr" size={14} />
              Pull requests <Count n={openPrs.length} />
              {red && <span className="tab-red" aria-label="checks failed" />}
            </button>
          )}
          {!tall && (github || nav.tab === "issues") && (
            <button type="button" aria-pressed={nav.tab === "issues"} onClick={() => go({ to: "tab", tab: "issues" })}>
              <Icon name="issue" size={14} />
              Issues <Count n={openIssues} />
            </button>
          )}
          {(needs > 0 || nav.tab === "needs") && (
            <button type="button" className="is-needs" aria-pressed={nav.tab === "needs"} onClick={() => go({ to: "tab", tab: "needs" })}>
              <Icon name="needs" size={14} />
              Needs you <Count n={needs} loud />
            </button>
          )}
        </nav>
        <div className={cx("top-tools", searching && "is-searching")}>
          {line.length > 0 && <span className="top-meta num">{line.join(" · ")}</span>}
          {channel.hold && (
            <span className="top-hold" title={channel.hold.note}>
              paused
            </span>
          )}
          {searching && (
            <div className="top-find">
              <Suspense fallback={null}>
                <SearchBox channel={channel} focusAsk={focusAsk} onJump={setJump} onClose={() => setSearching(false)} />
              </Suspense>
            </div>
          )}
          <div className="top-group">
            <IconButton icon="search" label="Search this channel (⌘F)" onClick={() => setSearching(true)} />
            <IconButton icon="terminal" label="Your terminal" pressed={nav.term?.kind === "you"} onClick={() => go({ to: "term", term: nav.term?.kind === "you" ? null : { kind: "you" } })} />
          </div>
        </div>
      </header>
      <Sidebar channel={channel} />
      <main className={cx("main", tall && nav.tab !== "needs" && "is-tall")}>
        <Boundary resetKey={nav.tab}>
          <Suspense fallback={null}>
            {tall && nav.tab !== "needs" ? (
              <TallPage
                channel={channel}
                jump={jump}
                work={<Board channel={channel} needs={needs} tall />}
                open={
                  nav.panel ? (
                    <div className="panel">
                      <PanelView channel={channel} />
                    </div>
                  ) : null
                }
              />
            ) : nav.tab === "tasks" ? (
              <Board channel={channel} needs={needs} />
            ) : nav.tab === "agents" ? (
              <Lanes channel={channel} />
            ) : nav.tab === "prs" ? (
              <PullRequests channel={channel} />
            ) : nav.tab === "issues" ? (
              <Issues channel={channel} />
            ) : nav.tab === "needs" ? (
              <NeedsYou channel={channel} onJump={setJump} />
            ) : (
              <Conversation channel={channel} jump={jump} />
            )}
          </Suspense>
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
      {nav.panel && !(tall && nav.tab !== "needs") && (
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
          <PanelView channel={channel} />
        </aside>
      )}
    </div>
  )
}

function PanelView({ channel }: { channel: Channel }) {
  const { nav } = useApp()
  if (!nav.panel) return null
  return (
    <Boundary panel resetKey={JSON.stringify(nav.panel)}>
      <Suspense fallback={null}>
        {nav.panel.kind === "thread" ? (
          <ThreadPanel channel={channel} seq={nav.panel.seq} focus={nav.panel.focus} />
        ) : nav.panel.kind === "task" ? (
          <TaskPanel channel={channel} id={nav.panel.task} />
        ) : nav.panel.kind === "pr" ? (
          <PrPanel channel={channel} repo={nav.panel.repo} number={nav.panel.number} />
        ) : nav.panel.kind === "issue" ? (
          <IssuePanel channel={channel} repo={nav.panel.repo} number={nav.panel.number} />
        ) : nav.panel.kind === "person" ? (
          <PersonPanel channel={channel} name={nav.panel.name} />
        ) : nav.panel.kind === "channel" ? (
          <ChannelPanel channel={channel} />
        ) : nav.panel.kind === "invite" ? (
          <InvitePanel channel={channel} />
        ) : (
          <AddAgentPanel channel={channel} />
        )}
      </Suspense>
    </Boundary>
  )
}
