import { createContext, useContext } from "react"

import type { Actions, App, Where } from "~/model"

type Tab = "chat" | "tasks" | "needs"

export type Panel = { kind: "person"; name: string } | { kind: "task"; task: number } | { kind: "thread"; seq: number } | { kind: "channel" } | { kind: "invite" } | { kind: "add-agent" }

export type Dialog = "new-channel" | "join" | "palette" | null

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
}

export type Go =
  | { to: "channel"; code: string }
  | { to: "where"; where: Where }
  | { to: "tab"; tab: Tab }
  | { to: "panel"; panel: Panel | null }
  | { to: "dialog"; dialog: Dialog }
  | { to: "settings"; section?: Section }
  | { to: "back" }
  | { to: "home" }
  | { to: "invite"; code: string }

const GENERAL: Where = { kind: "room", room: "general" }

export const startNav = (channel: string | null): Nav => ({ page: "channel", channel, where: GENERAL, tab: "chat", panel: null, dialog: null, section: "account" })

const lastWhere = new Map<string, Where>()

export function navigate(nav: Nav, go: Go): Nav {
  switch (go.to) {
    case "channel": {
      if (nav.channel) lastWhere.set(nav.channel, nav.where)
      return { ...nav, page: "channel", channel: go.code, where: lastWhere.get(go.code) ?? GENERAL, tab: "chat", panel: null, dialog: null }
    }
    case "where":
      return { ...nav, page: "channel", where: go.where, tab: "chat", panel: nav.panel?.kind === "thread" ? null : nav.panel }
    case "tab":
      return { ...nav, page: "channel", tab: go.tab }
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

export const sameWhere = (a: Where, b: Where): boolean =>
  a.kind === b.kind && (a.kind === "room" ? a.room === (b as { room: string }).room : a.kind === "dm" ? a.with === (b as { with: string }).with : a.task === (b as { task: number }).task)

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
