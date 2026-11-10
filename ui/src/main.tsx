import { StrictMode, useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { createRoot } from "react-dom/client"

import "~/styles/tokens.css"
import "~/styles/base.css"
import "~/styles/shell.css"
import "~/styles/chat.css"
import { Boundary } from "~/kit/boundary"
import { startLanguage } from "~/i18n/i18n"
import { warmLater } from "~/kit/later"
import { LiveDuties, useLive } from "~/live/live"
import { storedThemePrefs } from "~/live/prefs"
import { navigate, startNav, useKeepPlace, type Go, type Nav } from "~/nav"
import { Root } from "~/shell/root"
import { bootTheme } from "~/theme/apply"
import { loadRex } from "~/theme/rex"
import { wantsRex, type ThemePrefs } from "~/theme/themes"
import { migrateChannelsToStore } from "@kiwi/channel/store.ts"
import { ops } from "@kiwi/channel/channel-ops.ts"
import { hasBridge } from "@kiwi/secrets/relay.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"
import { noteSignInGone } from "@kiwi/channel/session.ts"
import { applyStoredAppearance, stepTextSize } from "@kiwi/app/theme.ts"
import { rememberChannel } from "@kiwi/app/last-channel.ts"
import { uiBooted, watchUiBoot } from "@kiwi/app/ui-boot.ts"
import { nudgeOnWake } from "@kiwi/app/wake.ts"

watchUiBoot()

const params = new URLSearchParams(location.search)
const demo = params.has("demo") || params.has("shot") || import.meta.env.VITE_KIWI_DEMO === "1"

if (hasBridge() && /Mac/.test(navigator.platform)) document.documentElement.dataset.shell = "mac"
else if (hasBridge() && /Linux/.test(navigator.platform)) document.documentElement.dataset.shell = "linux"

function LiveApp() {
  const [nav, setNav] = useState<Nav>(() => startNav(null))
  const app = useLive(nav.channel)
  const go = useCallback((g: Go) => setNav((n) => navigate(n, g)), [])
  const where = nav.page === "channel" && nav.tab === "chat" ? nav.where : null
  const task = nav.panel?.kind === "task" ? nav.panel.task : null
  const thread = nav.panel?.kind === "thread" ? nav.panel.seq : null
  const view = useMemo(() => ({ where, task, thread }), [where, task, thread])
  const [turn, setTurn] = useState(0)
  const [failed, setFailed] = useState(false)
  const crashed = useCallback(() => {
    rememberChannel(null)
    setFailed(true)
  }, [])
  const mended = useCallback(() => setFailed(false), [])
  const inChannel = !!nav.channel
  const broken = useMemo(() => (failed ? { channel: inChannel, retry: () => setTurn((n) => n + 1) } : undefined), [failed, inChannel])
  useEffect(uiBooted, [])
  useKeepPlace(nav)
  return (
    <>
      <Boundary quiet resetKey={`${nav.channel ?? ""} ${turn}`} onCrash={crashed} onMend={mended}>
        <LiveDuties open={nav.channel} view={view} go={go} />
      </Boundary>
      <Root app={app} nav={nav} go={go} broken={broken} />
    </>
  )
}

if (hasBridge()) void import("~/kit/native-menu").then((m) => m.quietNativeMenu())

if (!demo) {
  applyStoredAppearance()
  bridge()?.onTextStep(stepTextSize)
  void migrateChannelsToStore().catch(() => {})
  nudgeOnWake(() => ops().nudge())
  window.addEventListener("unhandledrejection", (e) => {
    if (noteSignInGone(e.reason)) e.preventDefault()
  })
}

const render = (app: ReactNode) => {
  const root = document.getElementById("root")
  if (root)
    createRoot(root).render(
      <StrictMode>
        <Boundary whole>{app}</Boundary>
      </StrictMode>
    )
}

const start = (prefs: ThemePrefs, app: ReactNode) => {
  const go = () => {
    bootTheme(prefs)
    render(app)
    warmLater()
  }
  const ready = Promise.all([startLanguage(), wantsRex(prefs) ? loadRex() : undefined])
  void ready.then(go, go)
}

if (demo) void import("~/demo/app").then(({ DemoApp, demoPrefs }) => start(demoPrefs, <DemoApp />))
else start(storedThemePrefs(), <LiveApp />)
