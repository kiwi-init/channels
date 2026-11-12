import { Fragment, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react"

import { t, useLanguage } from "~/i18n/i18n"
import { watchScrollbar } from "~/kit/scrollbar"
import { isBlueprintKey, toggleBlueprint, useBlueprint } from "~/kit/blueprint-on"
import { Boundary, Crashed } from "~/kit/boundary"
import { later } from "~/kit/later"
import { Toasts, useToasts } from "~/kit/toasts"
import type { App } from "~/model"
import { ActContext, AppContext, historyStep, type Ctx, type Go, type Nav, AccountContext, NamesContext, NavContext, OpenContext, PrefsContext, TilesContext } from "~/nav"
import { keyRan, onCommand } from "~/kit/commands"
import { mod } from "~/kit/keys"
import { ContextMenus } from "~/kit/menu-open"
import { ImageViews } from "~/chat/image-view"
import { Palette } from "~/palette/palette"
import { ChannelScreen } from "~/shell/channel"
import { Content } from "~/shell/content"
import { Frame } from "~/shell/frame"
import { opening } from "~/shell/opening"
import { Rail } from "~/shell/rail"
import { useLimitHit } from "~/usage/store"
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
const Waiting = later(() => import("~/start/waiting").then((m) => m.Waiting))
const AppSide = later(() => import("~/shell/app-side").then((m) => m.AppSide))
const Blueprint = later(() => import("~/kit/blueprint").then((m) => m.Blueprint))
const LimitDialog = later(() => import("~/usage/limit").then((m) => m.LimitDialog))

const RailOnce = memo(Rail)
const PaletteOnce = memo(Palette)
const MenusOnce = memo(ContextMenus)
const ImageViewsOnce = memo(ImageViews)
const ScreenOnce = memo(ChannelScreen)

type Broken = { channel: boolean; retry: () => void }

type RootProps = { app: App; nav: Nav; go: (go: Go) => void; broken?: Broken }

const inContent = (crashed: ReactNode) => <Content>{crashed}</Content>

export function Root(props: RootProps) {
  const { lang } = useLanguage()
  return (
    <Fragment key={lang}>
      <Shown {...props} />
    </Fragment>
  )
}

function Shown({ app, nav, go, broken }: RootProps) {
  const [toasts, toast, dismissToast] = useToasts()
  const ctx = useMemo(() => ({ app, nav, go, toast }), [app, nav, go, toast])
  const latest = useRef(app)
  useLayoutEffect(() => {
    latest.current = app
  }, [app])
  const now = useCallback(() => latest.current, [])
  const act = useMemo(() => ({ actions: app.actions, go, toast, now }), [app.actions, go, toast, now])
  const togglePalette = useCallback(() => go({ to: "dialog", dialog: nav.dialog === "palette" ? null : "palette" }), [go, nav.dialog])
  usePaletteKey(togglePalette)
  const blueprint = useBlueprint()
  useLayoutEffect(watchScrollbar, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isBlueprintKey(e)) return
      e.preventDefault()
      toggleBlueprint()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  useEffect(
    () =>
      onCommand((c) => {
        if (c === "settings") go({ to: "settings" })
        else if (c === "new-channel") go({ to: "dialog", dialog: "new-channel" })
        else if (c === "jump") togglePalette()
        else if (c === "back" || c === "forward") go({ to: "history", step: c })
      }),
    [go, togglePalette]
  )
  useHistoryKeys(go, !!nav.modal)
  useTheme(app)

  if (!app.account || app.signIn?.stage === "sign-in")
    return (
      <Parts ctx={ctx}>
        <ActContext value={act}>
          <Boundary>
            <Suspense fallback={null}>
              <FirstRun />
            </Suspense>
          </Boundary>
          <Toasts toasts={toasts} onDismiss={dismissToast} />
        </ActContext>
      </Parts>
    )

  return (
    <Parts ctx={ctx}>
      <ActContext value={act}>
        <div className="app">
          <RailOnce />
          <Boundary frame={inContent} resetKey={nav.page === "settings" ? "settings" : app.channel?.code}>
            {nav.page === "settings" ? (
              <Suspense fallback={null}>
                <Settings />
              </Suspense>
            ) : broken ? (
              <Plain title={app.channel?.title}>
                <Crashed title={t(broken.channel ? "kit.boundary.channel.title" : "kit.boundary.view.title")} sub={t("kit.boundary.retry.sub")}>
                  <button type="button" className="btn is-primary" onClick={broken.retry}>
                    {t("kit.boundary.retry")}
                  </button>
                  {broken.channel && (
                    <button type="button" className="btn" onClick={() => go({ to: "home" })}>
                      {t("kit.boundary.home")}
                    </button>
                  )}
                </Crashed>
              </Plain>
            ) : app.channel?.waiting ? (
              <Plain title={app.channel.title}>
                <Suspense fallback={null}>
                  <Waiting key={app.channel.code} channel={app.channel} />
                </Suspense>
              </Plain>
            ) : app.channel ? (
              <ScreenOnce key={app.channel.code} channel={app.channel} />
            ) : opening(app, nav) ? (
              <Plain />
            ) : (
              <Plain title={app.gone ? app.gone.title : t("shell.rail.home")}>
                <Suspense fallback={null}>{app.gone ? <Gone gone={app.gone} /> : <Welcome />}</Suspense>
              </Plain>
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
        <PaletteOnce />
        <MenusOnce />
        <ImageViewsOnce />
        <Toasts toasts={toasts} onDismiss={dismissToast} />
        <LimitWatch />
        {(blueprint || import.meta.env.VITE_KIWI_BLUEPRINT === "1") && (
          <Suspense fallback={null}>
            <Blueprint drawn={blueprint} />
          </Suspense>
        )}
      </ActContext>
    </Parts>
  )
}

function Plain({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <Frame
      title={title}
      side={
        <Suspense fallback={<div className="side" />}>
          <AppSide />
        </Suspense>
      }
    >
      <Content>{children}</Content>
    </Frame>
  )
}

function Parts({ ctx, children }: { ctx: Ctx; children: ReactNode }) {
  const { app, nav } = ctx
  return (
    <AppContext value={ctx}>
      <NavContext value={nav}>
        <TilesContext value={app.channels}>
          <PrefsContext value={app.prefs}>
            <AccountContext value={app.account}>
              <OpenContext value={app.channel}>
                <NamesContext value={app.channel?.nicknames ?? null}>{children}</NamesContext>
              </OpenContext>
            </AccountContext>
          </PrefsContext>
        </TilesContext>
      </NavContext>
    </AppContext>
  )
}

function LimitWatch() {
  const hit = useLimitHit()
  return hit ? (
    <Suspense fallback={null}>
      <LimitDialog hit={hit} />
    </Suspense>
  ) : null
}

function useHistoryKeys(go: (go: Go) => void, modal: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const step = historyStep(e)
      if (!step || e.defaultPrevented || document.querySelectorAll("dialog[open]").length > (modal ? 1 : 0)) return
      e.preventDefault()
      keyRan(step)
      go({ to: "history", step })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go, modal])
}

function usePaletteKey(toggle: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!mod(e) || e.key.toLowerCase() !== "k") return
      e.preventDefault()
      keyRan("jump")
      toggle()
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
