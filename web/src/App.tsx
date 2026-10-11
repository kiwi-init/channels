import { useCallback, useEffect, useMemo, useState } from "react"

import { Boundary, Toaster } from "@/components/kit"
import { ComputersModal, LinkComputerPage } from "@/components/computers"
import { AddDeviceModal, TakeChannelsPage } from "@/components/devices"
import { ChannelGate, JoinWithCode, NewChannel, Welcome } from "@/components/onboarding"
import { ChannelIconTile } from "@/components/channel-icon"
import { Sidebar } from "@/components/sidebar"
import { useIcons } from "@/lib/icons"
import { Palette, usePaletteShortcut, type Command } from "@/components/ui/palette"
import { Add01Icon, ChartColumnIcon, ComputerIcon, Login01Icon, Moon02Icon, Settings01Icon, SmartPhone01Icon, Sun03Icon } from "@hugeicons/core-free-icons"
import { Icon, type IconSvgElement } from "@/components/icon"
import { SettingsModal } from "@/components/settings"
import { UsageModal } from "@/components/usage"
import { PasskeysSheet } from "@/components/vault"
import { displayName, useAuth } from "@/lib/auth"
import { parseHash, useChannelList } from "@/lib/channel"
import { parseLinkHash } from "@/lib/computers"
import { newsTotal, rowNews, startMarks, useMarks, useNewsKeys, useOpenNews, useTabNews } from "@/lib/news"
import { readOfferHash } from "@/lib/devices"
import { formatShort } from "@/lib/format"
import { setAppearance } from "@/lib/theme"
import { useUsage } from "@/lib/usage"
import { startVault } from "@/lib/vault"
import { cx } from "@/lib/utils"

// The join code (and optionally a signing identity) live in the URL
// fragment, which browsers never send to the server.
function readHash() {
  const parsed = parseHash(location.hash)
  // Don't leave a private key sitting in the address bar or history.
  if (parsed.identity) history.replaceState(null, "", `#${encodeURIComponent(parsed.code)}`)
  return parsed
}

const open = (code: string) => (location.hash = encodeURIComponent(code))

export default function App() {
  const auth = useAuth()
  const [link, setLink] = useState(() => parseLinkHash(location.hash))
  const [offer, setOffer] = useState(readOfferHash)
  const [{ code, identity }, setHash] = useState(readHash)
  const [sheet, setSheet] = useState<"new" | "join" | "computers" | "usage" | "device" | "passkeys" | "settings" | null>(null)
  const rows = useChannelList(auth.status === "signed-in", auth.token)
  const icons = useIcons()
  const usage = useUsage(auth.status === "signed-in", auth.token)
  const [palette, setPalette] = useState(false)
  usePaletteShortcut(useCallback(() => setPalette(true), []))
  const signedIn = auth.status === "signed-in"

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
    if (signedIn) {
      act("computers", "Your computers", ComputerIcon, () => setSheet("computers"))
      act("device", "Add a device", SmartPhone01Icon, () => setSheet("device"))
    }
    if (usage) act("usage", "Usage", ChartColumnIcon, () => setSheet("usage"))
    if (auth.status === "signed-out") act("signin", "Sign in", Login01Icon, auth.signIn)
    act("settings", "Settings", Settings01Icon, () => setSheet("settings"))
    list.push(
      { id: "light", group: "Appearance", label: "Light", run: () => setAppearance("light"), leading: lead(Sun03Icon) },
      { id: "dark", group: "Appearance", label: "Dark", run: () => setAppearance("dark"), leading: lead(Moon02Icon) },
      { id: "system", group: "Appearance", label: "System", run: () => setAppearance("system"), leading: lead(ComputerIcon) }
    )
    return list
  }, [rows, icons, signedIn, usage, auth.status, auth.signIn])

  // Signed in, the vault brings this person's channels to this browser.
  const user = auth.status === "signed-in" ? auth.user : null
  useEffect(() => {
    void startVault(user ? { user: user.id, email: user.email, name: displayName(user), token: auth.token } : null)
  }, [user, auth.token])

  useEffect(() => {
    const onHash = () => {
      setLink(parseLinkHash(location.hash))
      setOffer(readOfferHash())
      setHash(readHash())
    }
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  const close = () => {
    history.replaceState(null, "", location.pathname)
    setHash({ code: "", identity: null })
  }

  return (
    <>
      {offer ? (
        <TakeChannelsPage
          offer={offer}
          onDone={() => {
            history.replaceState(null, "", location.pathname)
            setOffer(null)
          }}
        />
      ) : link ? (
        <LinkComputerPage
          link={link}
          onDone={() => {
            history.replaceState(null, "", location.pathname)
            setLink(null)
          }}
        />
      ) : (
        <div className="flex h-svh overflow-hidden">
          <Sidebar
            rows={rows}
            news={news}
            active={code}
            onSelect={open}
            onNew={() => setSheet("new")}
            onJoin={() => setSheet("join")}
            onComputers={() => setSheet("computers")}
            onAddDevice={() => setSheet("device")}
            onPasskeys={() => setSheet("passkeys")}
            onSettings={() => setSheet("settings")}
            usage={usage}
            onUsage={() => setSheet("usage")}
            onPalette={() => setPalette(true)}
            className={code ? "hidden md:flex" : "flex"}
          />
          {/* The app: one inset panel on the frame (edge to edge on a phone). */}
          <main className={cx("min-w-0 flex-1 overflow-hidden bg-canvas md:my-2 md:mr-2 md:rounded-card md:shadow-[0_0_0_1px_var(--line)]", code ? "flex" : "hidden md:flex")}>
            {code ? (
              <Boundary resetKey={code}>
                <ChannelGate key={code} code={code} identity={identity} listed={rows.find((r) => r.code === code)} onBack={close} onGone={close} />
              </Boundary>
            ) : (
              <Welcome onNew={() => setSheet("new")} onJoin={() => setSheet("join")} />
            )}
          </main>
        </div>
      )}
      <NewChannel
        open={sheet === "new"}
        usage={usage}
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
      {sheet === "device" && <AddDeviceModal onClose={() => setSheet(null)} />}
      <PasskeysSheet open={sheet === "passkeys"} onClose={() => setSheet(null)} />
      <UsageModal open={sheet === "usage"} onClose={() => setSheet(null)} usage={usage} rows={rows} />
      <SettingsModal open={sheet === "settings"} onClose={() => setSheet(null)} />
      <Palette open={palette} onClose={() => setPalette(false)} commands={commands} />
      <Toaster />
    </>
  )
}
