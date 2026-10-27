import { useCallback, useEffect, useLayoutEffect, useMemo } from "react"

import { Toasts, useToasts } from "~/kit/toasts"
import type { App } from "~/model"
import { AppContext, type Go, type Nav } from "~/nav"
import { Palette } from "~/palette/palette"
import { Settings } from "~/settings/settings"
import { ChannelScreen } from "~/shell/channel"
import { Rail } from "~/shell/rail"
import { FirstRun } from "~/start/first-run"
import { JoinDialog } from "~/start/join"
import { NewChannelDialog } from "~/start/new-channel"
import { Welcome } from "~/start/welcome"
import { applyTheme, colorsOf, usePreview, useSystemDark } from "~/theme/apply"
import { activeTheme } from "~/theme/themes"

export function Root({ app, nav, go }: { app: App; nav: Nav; go: (go: Go) => void }) {
  const [toasts, toast] = useToasts()
  const ctx = { app, nav, go, toast }
  usePaletteKey(useCallback(() => go({ to: "dialog", dialog: nav.dialog === "palette" ? null : "palette" }), [go, nav.dialog]))
  useTheme(app)

  if (!app.account)
    return (
      <AppContext value={ctx}>
        <FirstRun />
        <Toasts toasts={toasts} />
      </AppContext>
    )

  return (
    <AppContext value={ctx}>
      <div className="app">
        <Rail />
        {nav.page === "settings" ? <Settings /> : app.channel ? <ChannelScreen key={app.channel.code} channel={app.channel} /> : <Welcome />}
      </div>
      <NewChannelDialog />
      <JoinDialog />
      <Palette />
      <Toasts toasts={toasts} />
    </AppContext>
  )
}

function usePaletteKey(toggle: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggle])
}

function useTheme(app: App) {
  const { theme, reduceMotion, textSize, darkTheme, lightTheme, customThemes } = app.prefs
  const systemDark = useSystemDark()
  const preview = usePreview()
  const active = useMemo(() => activeTheme({ theme, darkTheme, lightTheme, customThemes }, systemDark), [theme, darkTheme, lightTheme, customThemes, systemDark])
  useLayoutEffect(() => {
    const root = document.documentElement
    const mode = preview?.appearance ?? theme
    if (mode === "system") delete root.dataset.theme
    else root.dataset.theme = mode
    applyTheme(colorsOf(preview ?? active))
    if (reduceMotion) root.dataset.motion = "reduced"
    else delete root.dataset.motion
    root.style.setProperty("--zoom", String(1 + textSize * 0.08))
  }, [theme, reduceMotion, textSize, active, preview])
}
