import { Suspense, useEffect, useLayoutEffect, useState } from "react"
import { useLayout } from "~/panes/store"

import { Conversation } from "~/chat/conversation"
import type { Jump, Older } from "~/chat/search-box"
import { cx, IconButton, useLate } from "~/kit/bits"
import { keyRan, onCommand } from "~/kit/commands"
import { dialogOpen, keysHint, mod } from "~/kit/keys"
import { Boundary } from "~/kit/boundary"
import { later } from "~/kit/later"
import { useMedia, WIDE } from "~/kit/media"
import type { Channel } from "~/model"
import { drawerNews } from "~/live/links"
import { dropMessage, findWanted, specOfWanted, useWantedMessage } from "~/live/open-message"
import { sameWhere, useGo, useNav, useActions } from "~/nav"
import { whereKey } from "~/places"
import { useSidebarHidden } from "@kiwi/app/sidebar-hidden.ts"
import { Frame } from "~/shell/frame"
import { useDrawer } from "~/shell/side"
import { Content } from "~/shell/content"
import { viewOf } from "~/panes/place"
import { FocusScope, placeName, roomiest } from "~/panes/place"
import { Sidebar, ViewsBar } from "~/shell/sidebar"
import { useTabs, useTopLayout } from "~/shell/top-layout"
import { ActivityButton } from "~/chat/events"
import { t } from "~/i18n/i18n"

const Panes = later(() => import("~/panes/panes").then((m) => m.Panes))
const Page = later(() => import("~/panes/page").then((m) => m.Page))
const SearchBox = later(() => import("~/chat/search-box").then((m) => m.SearchBox))
const OlderView = later(() => import("~/chat/older-view").then((m) => m.OlderView))
const NarrowPanel = later(() => import("~/shell/narrow-panel").then((m) => m.NarrowPanel))
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
  const tabs = useTabs()
  const top = useTopLayout()
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
  const root = specOfWanted(wanted, channel.code, target, (seq) => (channel.specs ?? []).some((s) => s.ask === seq))
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
  const layout = useLayout(channel.code)
  useLayoutEffect(() => {
    if (!tabs || !nav.panel) return
    const panel = nav.panel
    const room = roomiest(channel.code)
    void import("~/panes/ops").then((m) => m.panelGo(channel.code, layout.focus, panel, room))
    go({ to: "panel", panel: null })
  }, [tabs, nav.panel, channel.code, layout.focus, go])
  const panelOpen = !!nav.panel && !tabs
  const now = useMedia(WIDE) && !panelOpen
  const view = viewOf(nav)
  useLayoutEffect(() => {
    const root = document.documentElement
    root.toggleAttribute("data-panel", panelOpen)
    return () => root.removeAttribute("data-panel")
  }, [panelOpen])
  const offline = useLate(channel.connection !== "live", 1000)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !dialogOpen() && !drawer && nav.panel) go({ to: "panel", panel: null })
      if (mod(e) && !e.altKey && e.key.toLowerCase() === "f" && !dialogOpen()) {
        e.preventDefault()
        keyRan("find")
        setSearching(true)
        setFocusAsk((n) => n + 1)
      }
    }
    const stop = onCommand((c) => {
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

  const title = placeName(channel, nav)
  const news = drawerNews(channel)

  return (
    <Frame
      className={cx(panelOpen && "has-panel", top && "is-top")}
      news={news}
      title={title}
      tools={
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
          <ActivityButton channel={channel} />
          <IconButton icon="search" label={t("shell.channel.search", { keys: keysHint("F") })} onClick={() => setSearching(true)} />
        </div>
      }
      side={
        <FocusScope code={channel.code} now={now}>
          <Sidebar channel={channel} views={!top} />
        </FocusScope>
      }
    >
      <Content>
        {top && <ViewsBar channel={channel} />}
        <Panes
          channel={channel}
          label={tabs ? title : undefined}
          now={now}
          place={<PlaceView channel={channel} />}
          main={
            <Boundary resetKey={nav.tab}>
              <Suspense fallback={null}>
                {older ? <OlderView channel={channel} older={older} onBack={() => setOlder(null)} /> : view ? <Page channel={channel} view={view} /> : <Conversation channel={channel} jump={jump} />}
              </Suspense>
            </Boundary>
          }
        />
        {offline && (
          <p className="conn" role="status">
            <span className="dot is-doing" aria-hidden="true" />
            {channel.connection === "connecting" ? t("shell.channel.connecting") : t("shell.channel.reconnecting")}
          </p>
        )}
        {panelOpen && (
          <Suspense fallback={null}>
            <NarrowPanel channel={channel} hidden={hidden} />
          </Suspense>
        )}
      </Content>
      <ModalView channel={channel} />
    </Frame>
  )
}

function PlaceView({ channel }: { channel: Channel }) {
  const view = viewOf(useNav())
  return view ? <Page channel={channel} view={view} /> : <Conversation channel={channel} jump={null} />
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
