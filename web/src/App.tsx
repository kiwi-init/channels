import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"

import { Boundary, Toaster } from "@/components/kit"
import { ChannelGate } from "@/components/onboarding"
import { FirstRun } from "@/components/first-run"
import { JoinWithCode, NewChannel, Welcome } from "@/components/lazy"
import { ChannelIconTile } from "@/components/channel-icon"
import { Sidebar } from "@/components/sidebar"
import { ShellSidebar } from "@/components/shell-sidebar"
import { useMemberIcons } from "@/lib/icons"
import { useIcons } from "@/lib/icons"
import type { Command, PaletteActions } from "@/components/ui/palette"
import { usePaletteShortcut } from "@/components/ui/palette-shortcut"
import { ComputersModal, Palette, preloadAccountItems, SettingsPage } from "@/components/lazy"
import { whenIdle } from "@/lib/later"
import { useAutoApproval } from "@/lib/auto-approval"
import { parseHash, useChannelList } from "@/lib/channel"
import { joinCodeFromLink } from "@/lib/deep-link"
import { newsTotal, rowNews, startMarks, useMarks, useNewsKeys, useOpenNews, useTabNews } from "@/lib/news"
import { formatShort } from "@/lib/format"
import { useSidebarShortcut } from "@/lib/sidebar-hidden"
import { bridge, useSecrets } from "@kiwi/secrets/secrets.ts"
import { cx } from "@/lib/utils"
import { lastChannel, rememberChannel, reopenable } from "@/lib/last-channel"

// The join code lives in the URL fragment, which never leaves the app.
const readHash = () => parseHash(location.hash)

const go = (code: string) => (location.hash = encodeURIComponent(code))

export default function App() {
  const person = useSecrets().person
  const [{ code }, setHash] = useState(readHash)
  const [sheet, setSheet] = useState<"new" | "join" | "computers" | null>(null)
  const [settings, setSettings] = useState(false)
  const rows = useChannelList()
  const icons = useIcons()
  const [palette, setPalette] = useState(false)
  usePaletteShortcut(useCallback(() => setPalette(true), []))
  useEffect(() => whenIdle(preloadAccountItems), [])
  useSidebarShortcut()
  const open = useCallback((c: string) => {
    setSettings(false)
    go(c)
  }, [])
  useMemberIcons(rows.filter((c) => c.state === "member").map((c) => c.code))
  // Every owned channel, watched in the background: your computers' agents in, a notification otherwise.
  useAutoApproval(rows)
  // The app's own computer joins the list once there's a person to certify it (lib/computers.ts).
  const personPk = person?.pk
  useEffect(() => {
    if (personPk) void import("@/lib/computers").then((m) => m.adoptThisComputer()).catch(() => {})
  }, [personPk])

  // What's new where: a dot per channel, the total in the tab, Alt+↑/↓ through the ones with news.
  const marks = useMarks()
  const openNews = useOpenNews()
  const news = useMemo(() => rows.map((r) => rowNews(r, marks, openNews)), [rows, marks, openNews])
  useEffect(() => startMarks(rows), [rows])
  useTabNews(newsTotal(news))
  useNewsKeys(
    rows,
    news,
    rows.findIndex((r) => r.code === code),
    (r) => open(r.code)
  )

  const commands = useMemo(
    (): Command[] =>
      rows.map((r) => ({
        id: `c-${r.room}`,
        group: "Channels",
        label: r.title,
        hint: r.state === "member" ? formatShort(r.ts) : undefined,
        keywords: r.recent?.text,
        leading: <ChannelIconTile icon={icons.get(r.room) ?? null} title={r.title} size={20} />,
        run: () => open(r.code),
      })),
    [rows, icons, open]
  )
  const actions = useMemo<PaletteActions>(() => ({ onNew: () => setSheet("new"), onJoin: () => setSheet("join"), onComputers: () => setSheet("computers"), onSettings: () => setSettings(true) }), [])

  const [restored, setRestored] = useState(false)
  if (!restored && person && (code || rows.length)) {
    setRestored(true)
    const last = code ? null : reopenable(lastChannel(), rows)
    if (last) setHash({ code: last })
  }
  useLayoutEffect(() => {
    if (code && readHash().code !== code) history.replaceState(null, "", `${location.pathname}${location.search}#${encodeURIComponent(code)}`)
  }, [code])
  useEffect(() => {
    if (code && rows.some((r) => r.code === code && r.state === "member")) rememberChannel(code)
  }, [code, rows])

  useEffect(() => {
    const onHash = () => {
      setHash(readHash())
    }
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  // A kiwi://join/<code> link opens its channel: the one that started the app, and each one after.
  // Main hands each link over once, so a reload doesn't open it again.
  useEffect(() => {
    const b = bridge()
    if (!b) return
    const take = () =>
      void b
        .getDeepLink()
        .then((url) => {
          const linked = url ? joinCodeFromLink(url) : null
          if (linked) open(linked)
        })
        .catch(() => {})
    take()
    return b.onDeepLink(take)
  }, [open])

  const close = useCallback(() => {
    history.replaceState(null, "", `${location.pathname}${location.search}`)
    rememberChannel(null)
    setHash({ code: "" })
  }, [])

  return (
    <>
      {!person ? (
        <>
          <div aria-hidden className="drag fixed inset-x-0 top-0 z-10 h-(--chrome-h)" />
          <FirstRun />
        </>
      ) : (
        <ShellSidebar
          rows={rows}
          news={news}
          active={settings ? "" : code}
          inChannel={!settings && rows.some((r) => r.code === code && r.state === "member")}
          place={settings}
          onSelect={open}
          onNew={() => setSheet("new")}
          onComputers={() => setSheet("computers")}
          onSettings={() => setSettings(true)}
        >
          <div className="flex min-h-0 min-w-0 flex-1 overflow-clip md:overflow-visible">
            <Sidebar
              rows={rows}
              news={news}
              active={settings ? "" : code}
              onSelect={open}
              onNew={() => setSheet("new")}
              onComputers={() => setSheet("computers")}
              onSettings={() => setSettings(true)}
              className={cx(code || settings ? "hidden" : "flex", "md:hidden")}
            />
            <main className={cx("relative min-w-0 flex-1 overflow-clip bg-canvas md:overflow-visible md:bg-transparent md:pl-(--step)", code || settings ? "flex" : "hidden md:flex")}>
              {settings && (
                <div className="flex min-w-0 flex-1 md:sheet">
                  <SettingsPage backTo={rows.find((r) => r.code === code)?.title ?? "Channels"} onClose={() => setSettings(false)} />
                </div>
              )}
              <div className={cx("min-w-0 flex-1", settings ? "hidden" : "flex")}>
                {code ? (
                  <Boundary resetKey={code}>
                    <ChannelGate key={code} code={code} listedState={rows.find((r) => r.code === code)?.state} onBack={close} onGone={close} />
                  </Boundary>
                ) : (
                  <div className="flex min-w-0 flex-1 md:sheet">
                    <Welcome onNew={() => setSheet("new")} onJoin={() => setSheet("join")} />
                  </div>
                )}
              </div>
              {/* Last in the document, not just on top: the desktop app works out what drags the window
                in document order, whatever the z-index, so a header after these would swallow their clicks. */}
            </main>
          </div>
        </ShellSidebar>
      )}
      <NewChannel
        open={sheet === "new"}
        onJoin={() => setSheet("join")}
        onClose={() => setSheet(null)}
        onCreated={(c) => {
          setSheet(null)
          open(c)
        }}
      />
      <JoinWithCode
        open={sheet === "join"}
        onClose={() => setSheet(null)}
        onJoin={(c) => {
          setSheet(null)
          open(c)
        }}
      />
      <ComputersModal open={sheet === "computers"} onClose={() => setSheet(null)} />
      <Palette open={palette} onClose={() => setPalette(false)} commands={commands} actions={actions} />
      <Toaster />
    </>
  )
}
