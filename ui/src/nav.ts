import type { Tone } from "~/kit/toasts"
import { createContext, use, useContext, useEffect } from "react"

import type { Account, Actions, App, Channel, ChannelTile, Prefs, Where } from "~/model"
import { keepPlace, keptPlace, spotAt, spotKey, whereKey, type Spot, type Tab } from "~/places"

export type SpecPart = "spec" | "inside" | "result"

export type GithubView = "prs" | "issues"

export type Panel = { kind: "task"; task: number } | { kind: "pr"; repo: string; number: number } | { kind: "issue"; repo: string; number: number } | { kind: "thread"; seq: number; focus?: number }

export type ChannelTab = "general" | "rooms" | "github" | "notes"

type ModalView = { kind: "person"; name: string } | { kind: "channel"; tab?: ChannelTab } | { kind: "invite" } | { kind: "add-agent" } | { kind: "versions"; thread: string; name: string }

type Dialog = "new-channel" | "new-room" | "join" | "palette" | null

export type Section = "account" | "appearance" | "computers" | "agents" | "about"

type Place = { at: "home" } | { at: "settings"; section: Section } | { at: "channel"; channel: string; where: Where; tab: Tab; spot: Spot | null; spec?: number; part?: SpecPart }

export interface Nav {
  page: "channel" | "settings"
  channel: string | null
  where: Where
  tab: Tab
  panel: Panel | null
  modal: ModalView | null
  dialog: Dialog
  section: Section
  invite?: string
  github?: GithubView
  spec?: number
  part?: SpecPart
  back: readonly Place[]
  ahead: readonly Place[]
  visit: number
  restore?: Spot | null
}

export type Go =
  | { to: "channel"; code: string; jump?: true }
  | { to: "where"; where: Where; jump?: true; replace?: true }
  | { to: "tab"; tab: Tab }
  | { to: "github"; view: GithubView }
  | { to: "spec"; ask: number | null; part?: SpecPart }
  | { to: "panel"; panel: Panel | null }
  | { to: "task"; task: number }
  | { to: "modal"; modal: ModalView | null }
  | { to: "dialog"; dialog: Dialog }
  | { to: "settings"; section?: Section }
  | { to: "back" }
  | { to: "home" }
  | { to: "invite"; code: string }
  | { to: "history"; step: "back" | "forward" }

const GENERAL: Where = { kind: "room", room: "general" }

const HISTORY = 50

export const startNav = (channel: string | null): Nav => ({
  page: "channel",
  channel,
  where: GENERAL,
  tab: "chat",
  panel: null,
  modal: null,
  dialog: null,
  section: "account",
  back: [],
  ahead: [],
  visit: 0,
})

export const sameWhere = (a: Where, b: Where): boolean => whereKey(a) === whereKey(b)

function placeOf(nav: Nav): Place {
  if (nav.page === "settings") return { at: "settings", section: nav.section }
  if (!nav.channel) return { at: "home" }
  const spec = nav.tab === "specs" && nav.spec !== undefined ? { spec: nav.spec, ...(nav.part ? { part: nav.part } : {}) } : {}
  return { at: "channel", channel: nav.channel, where: nav.where, tab: nav.tab, spot: spotAt(spotKey(nav.channel, nav.where)), ...spec }
}

function samePlace(a: Place, b: Place): boolean {
  if (a.at === "home") return b.at === "home"
  if (a.at === "settings") return b.at === "settings" && a.section === b.section
  return b.at === "channel" && a.channel === b.channel && a.tab === b.tab && sameWhere(a.where, b.where) && a.spec === b.spec
}

export function navigate(nav: Nav, go: Go): Nav {
  if (go.to === "history") return nav.modal ? { ...nav, modal: null } : travel(nav, go.step)
  const next = step(nav, go)
  const was = placeOf(nav)
  const restore = next.restore === undefined ? next : { ...next, restore: undefined }
  if (go.to === "where" && go.replace) return restore
  const jumped = (go.to === "where" || go.to === "channel") && !!go.jump
  if (!jumped && samePlace(was, placeOf(next))) return restore
  return { ...restore, back: [...nav.back, was].slice(-HISTORY), ahead: [] }
}

export function historyStep(e: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "key" | "code">): "back" | "forward" | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return null
  if (e.code === "BracketLeft" || e.key === "[") return "back"
  if (e.code === "BracketRight" || e.key === "]") return "forward"
  return null
}

function arrive(nav: Nav, to: Place): Nav {
  const shut = { modal: null, dialog: null, spec: undefined, part: undefined, visit: nav.visit + 1 }
  if (to.at === "settings") return { ...nav, ...shut, page: "settings", section: to.section, restore: undefined }
  if (to.at === "home") return { ...nav, ...shut, page: "channel", channel: null, where: GENERAL, tab: "chat", panel: null, restore: undefined }
  return {
    ...nav,
    ...shut,
    page: "channel",
    channel: to.channel,
    where: to.where,
    tab: to.tab,
    panel: nav.channel !== to.channel || nav.panel?.kind === "thread" ? null : nav.panel,
    ...(to.spec !== undefined ? { spec: to.spec, part: to.part ?? "spec" } : {}),
    restore: to.spot,
  }
}

function travel(nav: Nav, way: "back" | "forward"): Nav {
  const from = way === "back" ? nav.back : nav.ahead
  const to = from.at(-1)
  if (!to) return nav
  const here = placeOf(nav)
  const rest = from.slice(0, -1)
  const moved = arrive(nav, to)
  return way === "back" ? { ...moved, back: rest, ahead: [...nav.ahead, here] } : { ...moved, ahead: rest, back: [...nav.back, here] }
}

function step(nav: Nav, go: Exclude<Go, { to: "history" }>): Nav {
  switch (go.to) {
    case "channel": {
      const kept = go.code === nav.channel ? { where: nav.where, tab: "chat" as const } : keptPlace(go.code)
      return { ...nav, page: "channel", channel: go.code, where: kept?.where ?? GENERAL, tab: kept?.tab ?? "chat", panel: null, modal: null, dialog: null }
    }
    case "where":
      return { ...nav, page: "channel", where: go.where, tab: "chat", panel: nav.panel?.kind === "thread" ? null : nav.panel, modal: null }
    case "tab":
      return { ...nav, page: "channel", tab: go.tab }
    case "github":
      return { ...nav, page: "channel", tab: "github", github: go.view }
    case "spec":
      return go.ask === null
        ? { ...nav, page: "channel", tab: "specs", spec: undefined, part: undefined }
        : { ...nav, page: "channel", tab: "specs", spec: go.ask, part: go.part ?? "spec", panel: null, modal: null }
    case "panel":
      return { ...nav, panel: go.panel, modal: go.panel ? null : nav.modal }
    case "task": {
      const open = nav.panel?.kind === "task" && nav.panel.task === go.task
      return { ...nav, panel: open ? null : { kind: "task", task: go.task }, modal: open ? nav.modal : null }
    }
    case "modal":
      return { ...nav, modal: go.modal }
    case "dialog":
      return { ...nav, dialog: go.dialog, ...(go.dialog === "join" ? {} : { invite: undefined }) }
    case "invite":
      return { ...nav, dialog: "join", invite: go.code }
    case "settings":
      return { ...nav, page: "settings", section: go.section ?? nav.section, modal: null, dialog: null }
    case "back":
      return { ...nav, page: "channel" }
    case "home":
      return { ...nav, page: "channel", channel: null, where: GENERAL, tab: "chat", panel: null, modal: null, dialog: null }
  }
}

export function useKeepPlace(nav: Nav): void {
  const { page, channel, where, tab } = nav
  useEffect(() => {
    if (page === "channel" && channel) keepPlace(channel, { where, tab })
  }, [page, channel, where, tab])
}

export interface Ctx {
  app: App
  nav: Nav
  go: (go: Go) => void
  toast: (text: string, tone?: Tone) => void
}

export const AppContext = createContext<Ctx | null>(null)

export function useApp(): Ctx {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp outside the app")
  return ctx
}

const whole = (ctx: Ctx | null): Ctx => {
  if (!ctx) throw new Error("useApp outside the app")
  return ctx
}

export const NavContext = createContext<Nav | undefined>(undefined)
export const TilesContext = createContext<ChannelTile[] | undefined>(undefined)
export const PrefsContext = createContext<Prefs | undefined>(undefined)
export const AccountContext = createContext<Account | null | undefined>(undefined)
export const NamesContext = createContext<ReadonlyMap<string, string> | null | undefined>(undefined)
export const OpenContext = createContext<Channel | null | undefined>(undefined)

export function useNav(): Nav {
  return use(NavContext) ?? whole(use(AppContext)).nav
}

export function useTiles(): ChannelTile[] {
  return use(TilesContext) ?? whole(use(AppContext)).app.channels
}

export function useAppPrefs(): Prefs {
  return use(PrefsContext) ?? whole(use(AppContext)).app.prefs
}

export function useAppAccount(): Account | null {
  const account = use(AccountContext)
  return account === undefined ? whole(use(AppContext)).app.account : account
}

const NO_NICKNAMES: ReadonlyMap<string, string> = new Map()

export function useNicknames(): ReadonlyMap<string, string> {
  const names = use(NamesContext)
  return (names === undefined ? use(AppContext)?.app.channel?.nicknames : names) ?? NO_NICKNAMES
}

export function useOpenChannel(): Channel | null {
  const channel = use(OpenContext)
  return channel === undefined ? whole(use(AppContext)).app.channel : channel
}

export function useActions(): Actions {
  const act = use(ActContext)
  return act ? act.actions : whole(use(AppContext)).app.actions
}

export function useGo(): (go: Go) => void {
  return (use(ActContext) ?? whole(use(AppContext))).go
}

export function useToast(): (text: string, tone?: Tone) => void {
  return (use(ActContext) ?? whole(use(AppContext))).toast
}

export interface Act {
  actions: Actions
  go: (go: Go) => void
  toast: (text: string, tone?: Tone) => void
}

export const ActContext = createContext<Act | null>(null)

export function useAct(): Act {
  const act = useContext(ActContext)
  if (!act) throw new Error("useAct outside the app")
  return act
}
