import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react"

import { Conversation } from "~/chat/conversation"
import type { Jump, Older } from "~/chat/search-box"
import { cx, Count, IconButton, useLate } from "~/kit/bits"
import { useGlide } from "~/kit/glide"
import { keyRan, onCommand } from "~/kit/commands"
import { dialogOpen, keysHint, mod } from "~/kit/keys"
import { Boundary } from "~/kit/boundary"
import { Icon } from "~/kit/icons"
import { later } from "~/kit/later"
import type { Channel } from "~/model"
import { drawerNews } from "~/live/links"
import { dropMessage, findWanted, useWantedMessage } from "~/live/open-message"
import { openAsks } from "~/needs/open"
import { sameWhere, useGo, useNav, useActions, useAppPrefs, useTiles } from "~/nav"
import { openMenu } from "~/kit/menu-open"
import { whereKey } from "~/places"
import { useSidebarHidden } from "@kiwi/app/sidebar-hidden.ts"
import { usePanelWidth } from "~/shell/panel-width"
import { isSideKey, setDrawer, toggleSide, useDrawer, useTall } from "~/shell/side"
import { Sidebar } from "~/shell/sidebar"
import { setUpdatesSlot } from "~/chat/updates-slot"
import { useSideways } from "~/kit/sideways"
import { openTasks } from "~/tasks/open"
import { headerLine } from "~/now"
import { between, nickname } from "~/names"
import { t } from "~/i18n/i18n"

const TallPage = lazy(() => import("~/shell/tall"))
const Waiting = later(() => import("~/start/waiting").then((m) => m.Waiting))
const SearchBox = later(() => import("~/chat/search-box").then((m) => m.SearchBox))
const OlderView = later(() => import("~/chat/older-view").then((m) => m.OlderView))
const Lanes = later(() => import("~/tasks/lanes").then((m) => m.Lanes))
const GithubView = later(() => import("~/github/view").then((m) => m.GithubView))
const SpecsView = later(() => import("~/specs/view").then((m) => m.SpecsView))
const PrPanel = later(() => import("~/github/panel").then((m) => m.PrPanel))
const IssuePanel = later(() => import("~/github/panel").then((m) => m.IssuePanel))
const NeedsYou = later(() => import("~/needs/needs").then((m) => m.NeedsYou))
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
  const tiles = useTiles()
  const prefs = useAppPrefs()
  const hidden = useSidebarHidden()
  const panel = usePanelWidth(hidden)
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

  const needs = openAsks(channel).length
  const tasks = openTasks(channel).length
  const agents = channel.people.some((p) => p.kind === "agent" && !p.left)
  const github = channel.repos.length > 0 || !!channel.prs?.length || !!channel.issues?.length
  const openPrs = channel.prs?.filter((p) => p.state === "open" || p.state === "draft") ?? []
  const red = openPrs.some((p) => p.checks === "fail" || !!p.ticks?.failed.length)
  const openIssues = channel.issues?.filter((i) => i.state === "open").length ?? 0
  const specs = channel.specs?.filter((s) => !s.result) ?? []
  const specsNeed = specs.filter((s) => s.canJudge && (s.stage === "draft" || s.stage === "delivered" || s.changed)).length
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
  const paged = tall && nav.tab !== "needs" && nav.tab !== "github"

  return (
    <div className={cx("chan", nav.panel && !paged && "has-panel", drawer && "is-drawer", hidden && "is-bare")} style={{ "--panel-w": `${panel.width}px` } as CSSProperties}>
      <header className="top">
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
        <div className="top-title">
          <button
            type="button"
            className="top-chan"
            aria-haspopup="menu"
            aria-label={t("shell.channel.menu.label", { name: channel.title })}
            onClick={(e) => {
              const at = e.currentTarget.getBoundingClientRect()
              const tile = tiles.find((c) => c.code === channel.code)
              void import("~/shell/rail-menu").then((m) =>
                openMenu.set(
                  m.railMenu(
                    { kind: "channel", code: channel.code },
                    { x: at.left, y: at.bottom + 4 },
                    {
                      noFolders: true,
                      folders: [],
                      save: () => {},
                      title: () => channel.title,
                      muted: (code) => prefs.muted.includes(code),
                      setMute: (code, on) => actions.setMute(code, null, on),
                      settings: () => go({ to: "modal", modal: { kind: "channel" } }),
                      own: channel.youOwn,
                      invite: () => go({ to: "modal", modal: { kind: "invite" } }),
                      end: () => go({ to: "modal", modal: { kind: "channel", end: true } }),
                      read: (tile?.unread ?? 0) > 0 ? (code) => actions.markChannelRead(code, tile?.head) : null,
                    }
                  )
                )
              )
            }}
          >
            <span className="top-name">{channel.title}</span>
            <Icon name="down" size={14} />
          </button>
        </div>
        <nav ref={tabsRef} className="tabs" aria-label={t("shell.channel.views")}>
          <button type="button" aria-pressed={nav.tab === "chat" || paged} onClick={() => go({ to: "tab", tab: "chat" })}>
            {here}
          </button>
          {!tall && (
            <button
              type="button"
              aria-pressed={nav.tab === "specs" || nav.tab === "tasks"}
              onClick={() => go({ to: "spec", ask: null })}
              title={specsNeed ? t("shell.channel.specs.need", { count: specsNeed }) : t("shell.channel.specs.open", { specs: specs.length, tasks })}
            >
              {t("shell.channel.specs")}
              {specsNeed > 0 && <span className="tab-red is-decide" role="img" aria-label={t("shell.channel.waiting.on.you")} />}
            </button>
          )}
          {!tall && (agents || nav.tab === "agents") && (
            <button type="button" className="is-agents" aria-pressed={nav.tab === "agents"} title={line.length ? line.join(" · ") : undefined} onClick={() => go({ to: "tab", tab: "agents" })}>
              {t("shell.channel.agents")}
            </button>
          )}
          {(github || nav.tab === "github") && (
            <button
              type="button"
              aria-pressed={nav.tab === "github"}
              onClick={() => go({ to: "tab", tab: "github" })}
              title={red ? t("shell.channel.github.red") : t("shell.channel.github.open", { prs: openPrs.length, issues: openIssues })}
            >
              {t("shell.channel.github")}
              {red && <span className="tab-red" role="img" aria-label={t("shell.channel.checks.failed")} />}
            </button>
          )}
          {(needs > 0 || nav.tab === "needs") && (
            <button type="button" className="is-needs" aria-pressed={nav.tab === "needs"} onClick={() => go({ to: "tab", tab: "needs" })}>
              {t("shell.channel.needs.you")} <Count n={needs} loud />
            </button>
          )}
        </nav>
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
          <div className="top-group">
            <span className="top-updates" ref={setUpdatesSlot} />
            <IconButton icon="search" label={t("shell.channel.search", { keys: keysHint("F") })} onClick={() => setSearching(true)} />
          </div>
        </div>
      </header>
      <Sidebar channel={channel} />
      <main className={cx("main", paged && "is-tall")}>
        <Boundary resetKey={nav.tab}>
          <Suspense fallback={null}>
            {older ? (
              <OlderView channel={channel} older={older} onBack={() => setOlder(null)} />
            ) : paged ? (
              <TallPage
                channel={channel}
                jump={jump}
                work={<SpecsView channel={channel} tall />}
                open={
                  nav.panel ? (
                    <div className="panel">
                      <PanelView channel={channel} />
                    </div>
                  ) : null
                }
              />
            ) : nav.tab === "agents" ? (
              <Lanes channel={channel} />
            ) : nav.tab === "github" ? (
              <GithubView channel={channel} />
            ) : nav.tab === "specs" || nav.tab === "tasks" ? (
              <SpecsView channel={channel} />
            ) : nav.tab === "needs" ? (
              <NeedsYou channel={channel} onJump={setJump} />
            ) : (
              <Conversation channel={channel} jump={jump} />
            )}
          </Suspense>
        </Boundary>
      </main>
      {offline && (
        <p className="conn" role="status">
          <span className="dot is-doing" aria-hidden="true" />
          {channel.connection === "connecting" ? t("shell.channel.connecting") : t("shell.channel.reconnecting")}
        </p>
      )}
      {nav.panel && !paged && (
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
