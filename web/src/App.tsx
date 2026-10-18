import { useCallback, useEffect, useMemo, useState } from "react"

import { Boundary, Toaster } from "@/components/kit"
import { FirstRun } from "@/components/first-run"
import { ChannelGate } from "@/components/onboarding"
import { JoinWithCode, NewChannel, Welcome } from "@/components/lazy"
import { ChannelIconTile } from "@/components/channel-icon"
import { Rail, Sidebar } from "@/components/sidebar"
import { useMemberIcons } from "@/lib/icons"
import { useIcons } from "@/lib/icons"
import type { Command } from "@/components/ui/palette"
import { usePaletteShortcut } from "@/components/ui/palette-shortcut"
import { ComputersModal, Palette, SettingsModal } from "@/components/lazy"
import { Add01Icon, ComputerIcon, Login01Icon, Moon02Icon, Settings01Icon, Sun03Icon } from "@hugeicons/core-free-icons"
import { Icon, type IconSvgElement } from "@/components/icon"
import { useAutoApproval } from "@/lib/approval"
import { adoptThisComputer } from "@/lib/computers"
import { parseHash, useChannelList } from "@/lib/channel"
import { joinCodeFromLink } from "@/lib/deep-link"
import { newsTotal, rowNews, startMarks, useMarks, useNewsKeys, useOpenNews, useTabNews } from "@/lib/news"
import { formatShort } from "@/lib/format"
import { setAppearance } from "@/lib/theme"
import { bridge, useSecrets } from "@/lib/secrets"
import { cx } from "@/lib/utils"

// The join code lives in the URL fragment, which never leaves the app.
const readHash = () => parseHash(location.hash)

const open = (code: string) => (location.hash = encodeURIComponent(code))

export default function App() {
  const person = useSecrets().person
  const [{ code }, setHash] = useState(readHash)
  const [sheet, setSheet] = useState<"new" | "join" | "computers" | "settings" | null>(null)
  const rows = useChannelList()
  const icons = useIcons()
  const [palette, setPalette] = useState(false)
  usePaletteShortcut(useCallback(() => setPalette(true), []))
  useMemberIcons(rows.filter((c) => c.state === "member").map((c) => c.code))
  // Every owned channel, watched in the background: your computers' agents in, a notification otherwise.
  useAutoApproval(rows)
  // The app's own computer joins the list once there's a person to certify it (lib/computers.ts).
  const personPk = person?.pk
  useEffect(() => {
    if (personPk) void adoptThisComputer().catch(() => {})
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

  const commands = useMemo(() => {
    const list: Command[] = rows.map((r) => ({
      id: `c-${r.room}`,
      group: "Channels",
      label: r.title,
      hint: r.state === "member" ? formatShort(r.ts) : undefined,
      keywords: r.recent?.text,
      leading: <ChannelIconTile icon={icons.get(r.room) ?? null} title={r.title} size={20} />,
      run: () => open(r.code),
    }))
    // Every action wears the icon it has in the menus, so the palette and the menus read alike.
    const lead = (icon: IconSvgElement) => <Icon icon={icon} size={16} strokeWidth={1.5} className="text-ink-3" />
    const act = (id: string, label: string, icon: IconSvgElement, run: () => void) => list.push({ id, group: "Actions", label, run, leading: lead(icon) })
    act("new", "New channel", Add01Icon, () => setSheet("new"))
    act("join", "Join with a code", Login01Icon, () => setSheet("join"))
    act("computers", "Your computers", ComputerIcon, () => setSheet("computers"))
    act("settings", "Settings", Settings01Icon, () => setSheet("settings"))
    list.push(
      { id: "light", group: "Appearance", label: "Light", run: () => setAppearance("light"), leading: lead(Sun03Icon) },
      { id: "dark", group: "Appearance", label: "Dark", run: () => setAppearance("dark"), leading: lead(Moon02Icon) },
      { id: "system", group: "Appearance", label: "System", run: () => setAppearance("system"), leading: lead(ComputerIcon) }
    )
    return list
  }, [rows, icons])

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
  }, [])

  const close = () => {
    history.replaceState(null, "", location.pathname)
    setHash({ code: "" })
  }

  return (
    <>
      {!person ? (
        <>
          <div aria-hidden className="drag fixed inset-x-0 top-0 z-10 h-(--chrome-h)" />
          <FirstRun />
        </>
      ) : (
        <div className="flex h-svh overflow-clip">
          <Sidebar
            rows={rows}
            news={news}
            active={code}
            onSelect={open}
            onNew={() => setSheet("new")}
            onComputers={() => setSheet("computers")}
            onSettings={() => setSheet("settings")}
            className={cx(code ? "hidden" : "flex", "md:hidden")}
          />
          <Rail rows={rows} news={news} active={code} onSelect={open} onNew={() => setSheet("new")} onComputers={() => setSheet("computers")} onSettings={() => setSheet("settings")} />
          {/* The app: the conversation beside the list, in the same colour, under the same header row. */}
          <main className={cx("relative min-w-0 flex-1 overflow-clip bg-canvas", code ? "flex" : "hidden md:flex")}>
            {/* No conversation, no header: the top row still moves the window. */}
            {!code && <div aria-hidden className="drag absolute inset-x-0 top-0 h-(--chrome-h)" />}
            {code ? (
              <Boundary resetKey={code}>
                <ChannelGate key={code} code={code} listed={rows.find((r) => r.code === code)} onBack={close} onGone={close} />
              </Boundary>
            ) : (
              <Welcome onNew={() => setSheet("new")} onJoin={() => setSheet("join")} />
            )}
            {/* Last in the document, not just on top: the desktop app works out what drags the window
                in document order, whatever the z-index, so a header after these would swallow their clicks. */}
          </main>
        </div>
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
      <SettingsModal open={sheet === "settings"} onClose={() => setSheet(null)} />
      <Palette open={palette} onClose={() => setPalette(false)} commands={commands} />
      <Toaster />
    </>
  )
}
