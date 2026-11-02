import { createContext, useContext } from "react"

import type { Actions, App, Where } from "~/model"

type Tab = "chat" | "specs" | "tasks" | "agents" | "needs" | "github"

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

export type Dialog = "new-channel" | "new-room" | "join" | "palette" | null

export type TermOf = { kind: "agent"; name: string } | { kind: "you" }

export type Section = "account" | "appearance" | "notifications" | "computers" | "agents" | "updates" | "about"

export interface Nav {
  page: "channel" | "settings"
  channel: string | null
  where: Where
  tab: Tab
  panel: Panel | null
  dialog: Dialog
  section: Section
  invite?: string
  term?: TermOf
  github?: GithubView
  spec?: number
  part?: SpecPart
}

export type Go =
  | { to: "channel"; code: string }
  | { to: "where"; where: Where }
  | { to: "tab"; tab: Tab }
  | { to: "github"; view: GithubView }
  | { to: "spec"; ask: number | null; part?: SpecPart }
  | { to: "panel"; panel: Panel | null }
  | { to: "dialog"; dialog: Dialog }
  | { to: "settings"; section?: Section }
  | { to: "back" }
  | { to: "home" }
  | { to: "invite"; code: string }
  | { to: "term"; term: TermOf | null }

const GENERAL: Where = { kind: "room", room: "general" }

export const startNav = (channel: string | null): Nav => ({ page: "channel", channel, where: GENERAL, tab: "chat", panel: null, dialog: null, section: "account" })

const lastWhere = new Map<string, Where>()

export function navigate(nav: Nav, go: Go): Nav {
  switch (go.to) {
    case "channel": {
      if (nav.channel) lastWhere.set(nav.channel, nav.where)
      return { ...nav, page: "channel", channel: go.code, where: lastWhere.get(go.code) ?? GENERAL, tab: "chat", panel: null, dialog: null, term: undefined }
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
    case "term":
      return { ...nav, page: "channel", term: go.term ?? undefined }
    case "settings":
      return { ...nav, page: "settings", section: go.section ?? nav.section, dialog: null }
    case "back":
      return { ...nav, page: "channel" }
    case "home":
      return { ...nav, page: "channel", channel: null, where: GENERAL, tab: "chat", panel: null, dialog: null, term: undefined }
  }
}

export const whereKey = (w: Where): string => (w.kind === "room" ? `r:${w.room}` : w.kind === "dm" ? `d:${w.with}` : w.kind === "theirs" ? `p:${w.between.join("&")}` : `t:${w.task}`)

export const sameWhere = (a: Where, b: Where): boolean => whereKey(a) === whereKey(b)

export interface Ctx {
  app: App
  nav: Nav
  go: (go: Go) => void
  toast: (text: string) => void
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
  toast: (text: string) => void
}

export const ActContext = createContext<Act | null>(null)

export function useAct(): Act {
  const act = useContext(ActContext)
  if (!act) throw new Error("useAct outside the app")
  return act
}
