import type { Tone } from "~/kit/toasts"
import { createContext, useContext, useEffect } from "react"

import type { Actions, App, Where } from "~/model"
import { keepPlace, keptPlace, spotAt, spotKey, whereKey, type Spot, type Tab } from "~/places"

export type SpecPart = "spec" | "inside" | "result"

export type GithubView = "prs" | "issues"

export type Panel =
  | { kind: "person"; name: string }
  | { kind: "task"; task: number }
  | { kind: "pr"; repo: string; number: number }
  | { kind: "issue"; repo: string; number: number }
  | { kind: "thread"; seq: number; focus?: number }
  | { kind: "channel" }
  | { kind: "invite" }
  | { kind: "add-agent" }

type Dialog = "new-channel" | "new-room" | "join" | "palette" | null

export type Section = "account" | "appearance" | "computers" | "agents" | "updates" | "about"

interface Place {
  channel: string
  where: Where
  tab: Tab
  spot: Spot | null
}

export interface Nav {
  page: "channel" | "settings"
  channel: string | null
  where: Where
  tab: Tab
  panel: Panel | null
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
  | { to: "dialog"; dialog: Dialog }
  | { to: "settings"; section?: Section }
  | { to: "back" }
  | { to: "home" }
  | { to: "invite"; code: string }
  | { to: "history"; step: "back" | "forward" }

const GENERAL: Where = { kind: "room", room: "general" }

const HISTORY = 50

export const startNav = (channel: string | null): Nav => ({ page: "channel", channel, where: GENERAL, tab: "chat", panel: null, dialog: null, section: "account", back: [], ahead: [], visit: 0 })

export const sameWhere = (a: Where, b: Where): boolean => whereKey(a) === whereKey(b)

function placeOf(nav: Nav): Place | null {
  if (nav.page !== "channel" || !nav.channel) return null
  return { channel: nav.channel, where: nav.where, tab: nav.tab, spot: spotAt(spotKey(nav.channel, nav.where)) }
}

const samePlace = (a: Place, b: Nav): boolean => b.page === "channel" && a.channel === b.channel && a.tab === b.tab && sameWhere(a.where, b.where)

export function navigate(nav: Nav, go: Go): Nav {
  if (go.to === "history") return travel(nav, go.step)
  const next = step(nav, go)
  const was = placeOf(nav)
  const restore = next.restore === undefined ? next : { ...next, restore: undefined }
  if (!was || next.page !== "channel" || (go.to === "where" && go.replace)) return restore
  const jumped = (go.to === "where" || go.to === "channel") && !!go.jump
  if (!jumped && samePlace(was, next)) return restore
  return { ...restore, back: [...nav.back, was].slice(-HISTORY), ahead: [] }
}

export function historyStep(e: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "key" | "code">): "back" | "forward" | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return null
  if (e.code === "BracketLeft" || e.key === "[") return "back"
  if (e.code === "BracketRight" || e.key === "]") return "forward"
  return null
}

function travel(nav: Nav, way: "back" | "forward"): Nav {
  const from = way === "back" ? nav.back : nav.ahead
  const to = from.at(-1)
  if (!to) return nav
  const here = placeOf(nav)
  const rest = from.slice(0, -1)
  const moved: Nav = {
    ...nav,
    page: "channel",
    channel: to.channel,
    where: to.where,
    tab: to.tab,
    panel: nav.channel !== to.channel || nav.panel?.kind === "thread" ? null : nav.panel,
    dialog: null,
    spec: undefined,
    part: undefined,
    visit: nav.visit + 1,
    restore: to.spot,
  }
  const kept = here ? [here] : []
  return way === "back" ? { ...moved, back: rest, ahead: [...nav.ahead, ...kept] } : { ...moved, ahead: rest, back: [...nav.back, ...kept] }
}

function step(nav: Nav, go: Exclude<Go, { to: "history" }>): Nav {
  switch (go.to) {
    case "channel": {
      const kept = go.code === nav.channel ? { where: nav.where, tab: "chat" as const } : keptPlace(go.code)
      return { ...nav, page: "channel", channel: go.code, where: kept?.where ?? GENERAL, tab: kept?.tab ?? "chat", panel: null, dialog: null }
    }
    case "where":
      return { ...nav, page: "channel", where: go.where, tab: "chat", panel: nav.panel?.kind === "thread" ? null : nav.panel }
    case "tab":
      return { ...nav, page: "channel", tab: go.tab }
    case "github":
      return { ...nav, page: "channel", tab: "github", github: go.view }
    case "spec":
      return go.ask === null
        ? { ...nav, page: "channel", tab: "specs", spec: undefined, part: undefined }
        : { ...nav, page: "channel", tab: "specs", spec: go.ask, part: go.part ?? "spec", panel: null }
    case "panel":
      return { ...nav, panel: go.panel }
    case "dialog":
      return { ...nav, dialog: go.dialog, ...(go.dialog === "join" ? {} : { invite: undefined }) }
    case "invite":
      return { ...nav, dialog: "join", invite: go.code }
    case "settings":
      return { ...nav, page: "settings", section: go.section ?? nav.section, dialog: null }
    case "back":
      return { ...nav, page: "channel" }
    case "home":
      return { ...nav, page: "channel", channel: null, where: GENERAL, tab: "chat", panel: null, dialog: null }
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
