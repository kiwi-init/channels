import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react"

import { Conversation } from "~/chat/conversation"
import type { Jump, Older } from "~/chat/search-box"
import { cx, IconButton, useLate } from "~/kit/bits"
import { keyRan, onCommand } from "~/kit/commands"
import { dialogOpen, keysHint, mod } from "~/kit/keys"
import { Boundary } from "~/kit/boundary"
import { Icon } from "~/kit/icons"
import { later } from "~/kit/later"
import { useMedia, WIDE } from "~/kit/media"
import type { Channel } from "~/model"
import { drawerNews } from "~/live/links"
import { dropMessage, findWanted, useWantedMessage } from "~/live/open-message"
import { sameWhere, useGo, useNav, useActions } from "~/nav"
import { whereKey } from "~/places"
import { useSidebarHidden } from "@kiwi/app/sidebar-hidden.ts"
import { usePanelWidth } from "~/shell/panel-width"
import { useSideWidth } from "~/shell/side-width"
import { isSideKey, setDrawer, toggleSide, useDrawer } from "~/shell/side"
import { Sidebar } from "~/shell/sidebar"
import { useTopLayout } from "~/shell/top-layout"
import { ActivityButton } from "~/chat/events"
import { between, nickname } from "~/names"
import { t } from "~/i18n/i18n"

const PEEK_SLACK = 24
const SIDE_MOVE_MS = 320

const VIEW_NAMES = {
  chat: "shell.channel.views",
  specs: "shell.channel.specs",
  agents: "shell.channel.agents",
  github: "shell.channel.github",
  needs: "shell.channel.needs.you",
} as const

const Waiting = later(() => import("~/start/waiting").then((m) => m.Waiting))
const SearchBox = later(() => import("~/chat/search-box").then((m) => m.SearchBox))
const OlderView = later(() => import("~/chat/older-view").then((m) => m.OlderView))
const Lanes = later(() => import("~/tasks/lanes").then((m) => m.Lanes))
const GithubView = later(() => import("~/github/view").then((m) => m.GithubView))
const SpecsView = later(() => import("~/specs/view").then((m) => m.SpecsView))
const PrPanel = later(() => import("~/github/panel").then((m) => m.PrPanel))
const IssuePanel = later(() => import("~/github/panel").then((m) => m.IssuePanel))
const NeedsYou = later(() => import("~/needs/needs").then((m) => m.NeedsYou))
const Tracker = later(() => import("~/tasks/tracker").then((m) => m.Tracker))
const TaskPanel = later(() => import("~/panels/task").then((m) => m.TaskPanel))
const ThreadPanel = later(() => import("~/panels/thread").then((m) => m.ThreadPanel))
const Profile = later(() => import("~/modals/profile").then((m) => m.Profile))
const ChannelSettings = later(() => import("~/modals/channel-settings").then((m) => m.ChannelSettings))
const Invite = later(() => import("~/modals/invite").then((m) => m.Invite))
const AddAgent = later(() => import("~/modals/add-agent").then((m) => m.AddAgent))
const DocVersions = later(() => import("~/modals/doc-versions").then((m) => m.DocVersions))

export function ChannelScreen({ channel }: { channel: Channel }) {
  const nav = useNav()
  const go = useGo()
  const actions = useActions()
  const hidden = useSidebarHidden()
  const top = useTopLayout()
  const panel = usePanelWidth(hidden)
  const side = useSideWidth()
  useLayoutEffect(() => {
    const root = document.documentElement
    root.style.setProperty("--panel-w", `${panel.width}px`)
    return () => void root.style.removeProperty("--panel-w")
  }, [panel.width])
  const [jumpAt, setJumpAt] = useState<{ jump: Jump; visit: number } | null>(null)
  const jump = jumpAt?.visit === nav.visit ? jumpAt.jump : null
  const setJump = (j: Jump | null) => setJumpAt(j ? { jump: j, visit: nav.visit } : null)
  const place = `${channel.code}\n${nav.tab}\n${whereKey(nav.where)}`
  const [olderAt, setOlderAt] = useState<{ older: Older; place: string } | null>(null)
  if (olderAt && olderAt.place !== place) setOlderAt(null)
  const older = olderAt?.older ?? null
  const setOlder = (o: Older | null) => setOlderAt(o ? { older: o, place } : null)
  const [focusAsk, setFocusAsk] = useState(0)
  if (jump && (nav.tab !== "chat" || !sameWhere(jump.m.where, nav.where))) setJump(null)
  const wanted = useWantedMessage()
  const found = findWanted(wanted, channel.code, channel.messages, channel.since)
  const target = found.kind === "found" ? found.m : null
  const specAsk = (seq: number | undefined): boolean => seq !== undefined && (channel.specs ?? []).some((s) => s.ask === seq)
  const root = wanted?.code === channel.code && specAsk(wanted.seq) ? wanted.seq : specAsk(target?.inThread) ? target?.inThread : undefined
  const anchor = root === undefined ? target : null
  const atAnchor = !!anchor && nav.tab === "chat" && sameWhere(anchor.where, nav.where)
  if (anchor && atAnchor && jump?.m.seq !== anchor.seq) setJump({ m: anchor, terms: [] })
  const earlierTo = actions.earlierTo
  useEffect(() => {
    if (!wanted || found.kind !== "older" || root !== undefined) return
    void earlierTo(wanted.code, wanted.seq).then((held) => {
      if (!held) dropMessage(wanted)
    })
  }, [wanted, found.kind, earlierTo, root])
  useEffect(() => {
    if (!wanted) return
    if (root !== undefined) {
      go({ to: "spec", ask: root, part: "spec" })
      return dropMessage(wanted)
    }
    if (found.kind === "missing") return dropMessage(wanted)
    if (!anchor) return
    if (!atAnchor) return go({ to: "where", where: anchor.where, replace: true })
    if (jump?.m.seq !== anchor.seq) return
    dropMessage(wanted)
  }, [wanted, found.kind, anchor, root, atAnchor, jump, go])
  const room = nav.where.kind === "room" ? nav.where.room : null
  const gone = room !== null && !channel.loading && channel.connection === "live" && nav.tab === "chat" && !channel.rooms.some((r) => r.id === room)
  useEffect(() => {
    if (gone) go({ to: "where", where: { kind: "room", room: "general" }, replace: true })
  }, [gone, go])
  const [searching, setSearching] = useState(false)
  const drawer = useDrawer()
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
  const panelOpen = !!nav.panel
  const reading = nav.tab === "specs" && nav.spec != null && !panelOpen
  const second = useMedia(WIDE) && !panelOpen && !older && !reading
  useLayoutEffect(() => {
    const root = document.documentElement
    root.toggleAttribute("data-bare", hidden)
    root.toggleAttribute("data-peek", peeking)
    root.toggleAttribute("data-panel", panelOpen)
    return () => {
      for (const name of ["data-bare", "data-peek", "data-panel"]) root.removeAttribute(name)
    }
  }, [hidden, peeking, panelOpen])
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
  const offline = useLate(channel.connection !== "live", 1000)
  useEffect(() => {
    setDrawer(false)
    return () => setDrawer(false)
  }, [nav.where])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSideKey(e)) {
        e.preventDefault()
        keyRan("sidebar")
        toggleSide()
      }
      if (e.key === "Escape" && !e.defaultPrevented && !dialogOpen()) {
        if (drawer) setDrawer(false)
        else if (nav.panel) go({ to: "panel", panel: null })
      }
      if (mod(e) && !e.altKey && e.key.toLowerCase() === "f" && !dialogOpen()) {
        e.preventDefault()
        keyRan("find")
        setSearching(true)
        setFocusAsk((n) => n + 1)
      }
    }
    const stop = onCommand((c) => {
      if (c === "sidebar") toggleSide()
      if (c === "find" && !dialogOpen()) {
        setSearching(true)
        setFocusAsk((n) => n + 1)
      }
    })
    window.addEventListener("keydown", onKey)
    return () => {
      stop()
      window.removeEventListener("keydown", onKey)
    }
  }, [nav.panel, go, drawer])

  if (channel.waiting)
    return (
      <Suspense fallback={null}>
        <Waiting channel={channel} />
      </Suspense>
    )

  const here =
    nav.where.kind === "room"
      ? `# ${channel.rooms.find((r) => r.id === (nav.where as { room: string }).room)?.name ?? "general"}`
      : nav.where.kind === "dm"
        ? `@ ${nickname(channel, nav.where.with)}`
        : nav.where.kind === "theirs"
          ? between(channel, nav.where.between)
          : `T${nav.where.task}`

  const title = nav.tab === "chat" ? here : t(VIEW_NAMES[nav.tab])
  const news = drawerNews(channel)

  return (
    <div className={cx("chan", nav.panel && "has-panel", drawer && "is-drawer", hidden && "is-bare", peeking && "is-peek", reading && "is-reading")}>
      {hidden && !peek && <div className="side-edge" onMouseEnter={() => setPeek(true)} />}
      {!hidden && (
        <div
          className="side-grip"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("shell.channel.resize.side")}
          aria-valuemin={side.min}
          aria-valuemax={side.max}
          aria-valuenow={side.width}
          tabIndex={0}
          title={t("shell.channel.resize.title")}
          {...side.grip}
        />
      )}
      <header className="top">
        <div className="top-lead">
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
        </div>
        {!top && <h1 className="top-here">{title}</h1>}
        <div className={cx("top-tools", searching && "is-searching")}>
          {channel.hold && nav.tab !== "chat" && (
            <span className="top-hold" title={channel.hold.note}>
              {t("shell.channel.paused")}
            </span>
          )}
          {searching && (
            <div className="top-find">
              <Suspense fallback={null}>
                <SearchBox channel={channel} focusAsk={focusAsk} onJump={(j) => (j && setOlder(null), setJump(j))} onOlder={setOlder} onClose={() => setSearching(false)} />
              </Suspense>
            </div>
          )}
          {!second && <ActivityButton channel={channel} />}
          <IconButton icon="search" label={t("shell.channel.search", { keys: keysHint("F") })} onClick={() => setSearching(true)} />
        </div>
      </header>
      <Sidebar channel={channel} views={!top} />
      <main className="main" aria-label={top ? title : undefined}>
        <Boundary resetKey={nav.tab}>
          <Suspense fallback={null}>
            {older ? (
              <OlderView channel={channel} older={older} onBack={() => setOlder(null)} />
            ) : nav.tab === "agents" ? (
              <Lanes channel={channel} />
            ) : nav.tab === "github" ? (
              <GithubView channel={channel} />
            ) : nav.tab === "specs" ? (
              <SpecsView channel={channel} />
            ) : nav.tab === "needs" ? (
              <NeedsYou channel={channel} onJump={setJump} />
            ) : (
              <Conversation channel={channel} jump={jump} />
            )}
          </Suspense>
        </Boundary>
      </main>
      {second && (
        <Suspense fallback={null}>
          <Tracker channel={channel} />
        </Suspense>
      )}
      {offline && (
        <p className="conn" role="status">
          <span className="dot is-doing" aria-hidden="true" />
          {channel.connection === "connecting" ? t("shell.channel.connecting") : t("shell.channel.reconnecting")}
        </p>
      )}
      {nav.panel && (
        <aside className="panel" aria-label={t("shell.channel.details")}>
          <div
            className="panel-grip"
            role="separator"
            aria-orientation="vertical"
            aria-label={t("shell.channel.resize")}
            aria-valuemin={panel.min}
            aria-valuemax={panel.max}
            aria-valuenow={panel.width}
            tabIndex={0}
            title={t("shell.channel.resize.title")}
            {...panel.grip}
          />
          <PanelView channel={channel} />
        </aside>
      )}
      <ModalView channel={channel} />
    </div>
  )
}

function PanelView({ channel }: { channel: Channel }) {
  const nav = useNav()
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
        ) : (
          <IssuePanel channel={channel} repo={nav.panel.repo} number={nav.panel.number} />
        )}
      </Suspense>
    </Boundary>
  )
}

function ModalView({ channel }: { channel: Channel }) {
  const nav = useNav()
  const go = useGo()
  const modal = nav.modal
  if (!modal) return null
  const close = () => go({ to: "modal", modal: null })
  return (
    <Boundary resetKey={JSON.stringify(modal)}>
      <Suspense fallback={null}>
        {modal.kind === "person" ? (
          <Profile key={modal.name} channel={channel} name={modal.name} onClose={close} />
        ) : modal.kind === "channel" ? (
          <ChannelSettings channel={channel} tab={modal.tab} end={modal.end} onClose={close} />
        ) : modal.kind === "invite" ? (
          <Invite channel={channel} onClose={close} />
        ) : modal.kind === "versions" ? (
          <DocVersions channel={channel} thread={modal.thread} name={modal.name} onClose={close} />
        ) : (
          <AddAgent channel={channel} onClose={close} />
        )}
      </Suspense>
    </Boundary>
  )
}
