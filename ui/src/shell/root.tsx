import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo } from "react"

import { Boundary } from "~/kit/boundary"
import { later } from "~/kit/later"
import { Toasts, useToasts } from "~/kit/toasts"
import type { App } from "~/model"
import { ActContext, AppContext, type Go, type Nav } from "~/nav"
import { Palette } from "~/palette/palette"
import { ChannelScreen } from "~/shell/channel"
import { Rail } from "~/shell/rail"
import { applyTheme, colorsOf, usePreview, useSystemDark } from "~/theme/apply"
import { loadRex, useRex } from "~/theme/rex"
import { activeTheme, wantsRex } from "~/theme/themes"

const Settings = later(() => import("~/settings/settings").then((m) => m.Settings))
const FirstRun = later(() => import("~/start/first-run").then((m) => m.FirstRun))
const Gone = later(() => import("~/start/gone").then((m) => m.Gone))
const NewChannelDialog = later(() => import("~/start/new-channel").then((m) => m.NewChannelDialog))
const EnrollDialog = later(() => import("~/settings/enroll").then((m) => m.EnrollDialog))
const JoinDialog = later(() => import("~/start/join").then((m) => m.JoinDialog))
const NewRoomDialog = later(() => import("~/shell/new-room").then((m) => m.NewRoomDialog))
const Welcome = later(() => import("~/start/welcome").then((m) => m.Welcome))

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
            <Suspense fallback={null}>
              <FirstRun />
            </Suspense>
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
            ) : (
              <Suspense fallback={null}>{app.gone ? <Gone gone={app.gone} /> : <Welcome />}</Suspense>
            )}
          </Boundary>
        </div>
        {nav.dialog === "new-channel" && (
          <Suspense fallback={null}>
            <NewChannelDialog />
          </Suspense>
        )}
        {nav.dialog === "new-room" && app.channel && (
          <Suspense fallback={null}>
            <NewRoomDialog channel={app.channel} />
          </Suspense>
        )}
        {nav.dialog === "join" && (
          <Suspense fallback={null}>
            <JoinDialog />
          </Suspense>
        )}
        {app.account?.enrollAsk && (
          <Suspense fallback={null}>
            <EnrollDialog />
          </Suspense>
        )}
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
