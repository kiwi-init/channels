import { StrictMode, useCallback, useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"

import "~/styles/tokens.css"
import "~/styles/base.css"
import "~/styles/shell.css"
import "~/styles/chat.css"
import { DEMO_PREFS } from "~/demo/data"
import { useDemo } from "~/demo/provider"
import { SHOTS } from "~/demo/shots"
import { LiveDuties, useLive } from "~/live/live"
import type { Prefs } from "~/model"
import { storedThemePrefs } from "~/live/prefs"
import { navigate, startNav, type Go, type Nav } from "~/nav"
import { Root } from "~/shell/root"
import { bootTheme } from "~/theme/apply"
import { migrateChannelsToStore } from "@/lib/channel"
import { ops } from "@/lib/channel-ops"
import { hasBridge } from "@/lib/relay"
import { bridge } from "@/lib/secrets"
import { noteSignInGone } from "@/lib/session"
import { applyStoredAppearance, stepTextSize } from "@/lib/theme"
import { uiBooted, watchUiBoot } from "@/lib/ui-boot"
import { nudgeOnWake } from "@/lib/wake"

watchUiBoot()

const params = new URLSearchParams(location.search)
const demo = params.has("demo") || params.has("shot") || import.meta.env.VITE_KIWI_DEMO === "1"
const shot = SHOTS[params.get("shot") ?? ""] ?? SHOTS.channel
const theme = params.get("theme")
const look: Partial<Prefs> = { ...shot?.prefs, ...(theme === "light" || theme === "dark" ? { theme } : {}) }

if (hasBridge() && /Mac/.test(navigator.platform)) document.documentElement.dataset.shell = "mac"
else if (hasBridge() && /Linux/.test(navigator.platform)) document.documentElement.dataset.shell = "linux"

function DemoApp() {
  const [nav, setNav] = useState<Nav>(() => ({ ...startNav(shot?.channel ?? null), ...shot?.nav }))
  const app = useDemo(shot?.scenario ?? "full", nav.channel, look)
  const go = useCallback((g: Go) => setNav((n) => navigate(n, g)), [])
  useEffect(uiBooted, [])
  return <Root app={app} nav={nav} go={go} />
}

function LiveApp() {
  const [nav, setNav] = useState<Nav>(() => startNav(null))
  const app = useLive(nav.channel)
  const go = useCallback((g: Go) => setNav((n) => navigate(n, g)), [])
  const where = nav.page === "channel" && nav.tab === "chat" ? nav.where : null
  const task = nav.panel?.kind === "task" ? nav.panel.task : null
  const view = useMemo(() => ({ where, task }), [where, task])
  useEffect(uiBooted, [])
  return (
    <>
      <LiveDuties open={nav.channel} view={view} go={go} />
      <Root app={app} nav={nav} go={go} />
    </>
  )
}

if (!demo) {
  applyStoredAppearance()
  bridge()?.onTextStep(stepTextSize)
  void migrateChannelsToStore().catch(() => {})
  nudgeOnWake(() => ops().nudge())
  window.addEventListener("unhandledrejection", (e) => {
    if (noteSignInGone(e.reason)) e.preventDefault()
  })
}

bootTheme(demo ? { ...DEMO_PREFS, ...look } : storedThemePrefs())

const root = document.getElementById("root")
if (root) createRoot(root).render(<StrictMode>{demo ? <DemoApp /> : <LiveApp />}</StrictMode>)
