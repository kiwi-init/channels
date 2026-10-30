import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo } from "react"

import { Boundary } from "~/kit/boundary"
import { later } from "~/kit/later"
import { Toasts, useToasts } from "~/kit/toasts"
import type { App } from "~/model"
import { ActContext, AppContext, type Go, type Nav } from "~/nav"
import { Palette } from "~/palette/palette"
import { ChannelScreen } from "~/shell/channel"
import { Rail } from "~/shell/rail"
import { FirstRun } from "~/start/first-run"
import { EnrollDialog } from "~/settings/enroll"
import { Gone } from "~/start/gone"
import { JoinDialog } from "~/start/join"
import { NewChannelDialog } from "~/start/new-channel"
import { Welcome } from "~/start/welcome"
import { applyTheme, colorsOf, usePreview, useSystemDark } from "~/theme/apply"
import { loadRex, useRex } from "~/theme/rex"
import { activeTheme, wantsRex } from "~/theme/themes"

const Settings = later(() => import("~/settings/settings").then((m) => m.Settings))

export function Root({ app, nav, go }: { app: App; nav: Nav; go: (go: Go) => void }) {
  const [toasts, toast] = useToasts()
  const ctx = useMemo(() => ({ app, nav, go, toast }), [app, nav, go, toast])
  const act = useMemo(() => ({ actions: app.actions, go, toast }), [app.actions, go, toast])
  usePaletteKey(useCallback(() => go({ to: "dialog", dialog: nav.dialog === "palette" ? null : "palette" }), [go, nav.dialog]))
  useTheme(app)

  if (!app.account || app.signIn?.stage === "sign-in")
    return (
      <AppContext value={ctx}>
        <ActContext value={act}>
          <Boundary>
            <FirstRun />
          </Boundary>
          <Toasts toasts={toasts} />
        </ActContext>
      </AppContext>
    )

  return (
    <AppContext value={ctx}>
      <ActContext value={act}>
        <div className="app">
          <Rail />
          <Boundary resetKey={nav.page === "settings" ? "settings" : app.channel?.code}>
            {nav.page === "settings" ? (
              <Suspense fallback={null}>
                <Settings />
              </Suspense>
            ) : app.channel ? (
              <ChannelScreen key={app.channel.code} channel={app.channel} />
            ) : app.gone ? (
              <Gone gone={app.gone} />
            ) : (
              <Welcome />
            )}
          </Boundary>
        </div>
        <NewChannelDialog />
        <JoinDialog />
        <EnrollDialog />
        <Palette />
        <Toasts toasts={toasts} />
      </ActContext>
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
  const { theme, reduceMotion, darkTheme, lightTheme, customThemes } = app.prefs
  const systemDark = useSystemDark()
  const preview = usePreview()
  const rex = useRex()
  const wants = wantsRex({ darkTheme, lightTheme, customThemes })
  useEffect(() => {
    if (wants) void loadRex()
  }, [wants])
  const active = useMemo(() => activeTheme({ theme, darkTheme, lightTheme, customThemes }, systemDark, rex), [theme, darkTheme, lightTheme, customThemes, systemDark, rex])
  useLayoutEffect(() => {
    const root = document.documentElement
    const mode = preview?.appearance ?? theme
    if (mode === "system") delete root.dataset.theme
    else root.dataset.theme = mode
    applyTheme(colorsOf(preview ?? active))
    if (reduceMotion) root.dataset.motion = "reduced"
    else delete root.dataset.motion
  }, [theme, reduceMotion, active, preview])
}
