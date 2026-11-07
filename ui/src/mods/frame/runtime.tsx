import * as React from "react"
import * as ReactDOM from "react-dom"
import * as ReactDOMClient from "react-dom/client"
import * as jsxRuntime from "react/jsx-runtime"
import type { ComponentType, ReactNode } from "react"
import type * as Kit from "@kiwi/mod"

import "~/styles/tokens.css"
import "~/styles/base.css"
import "~/styles/palette.css"
import "~/styles/chat.css"
import "~/mods/frame/frame.css"
import { Avatar, Count, cx, Dot, Heading } from "~/kit/bits"
import { Field } from "~/kit/form"
import { Track } from "~/kit/glide"
import { ago } from "~/kit/time"
import { Icon } from "~/mods/frame/glyphs"
import { Action, Actions, Detail, Empty, Form, List, useFetch } from "~/mods/frame/kit"
import { copy, failed, modFetch, openUrl, post, replied, request, storage, Toast } from "~/mods/frame/wire"
import {
  IDLE_MAX_MINUTES,
  MOD_PROTOCOL,
  type ModChannel,
  type ModGithub,
  type ModMessage,
  type ModOpen,
  type ModTarget,
  type ModTerminal,
  type ModTerminalMark,
  type Shown,
  type Surface,
  type TerminalOp,
  type ToFrame,
} from "~/mods/protocol"

type Draw = (shown: Shown & { dark: boolean }) => ReactNode | void

type Shaped = "github" | "useGithub" | "Avatar"

let view: ComponentType | null = null
let booted = false
let surface: Surface = "main"
let needs: ReadonlySet<string> = new Set()
let values: Readonly<Record<string, string | boolean | null>> = Object.freeze({})
const commands = new Map<string, { title: string; run: () => void | Promise<void> }>()
const actions = new Map<string, { title: string; run: (message: ModMessage) => void | Promise<void> }>()
const drawers = new Map<string, Draw>()
const placed = new Set<(list: ModTerminal[]) => void>()
const box = document.getElementById("root") ?? document.body.appendChild(document.createElement("div"))
const root = ReactDOMClient.createRoot(box)
let sized: ResizeObserver | null = null
let github: ModGithub | null = null
let channelList: ModChannel[] | null = null
let still = false
let rests = 0
let showing: ModTarget | null = null
let tabState: { title: string; shown: boolean; alert: string | null; hint: string | null } | null = null
const watchers = new Set<() => void>()
const onShows = new Set<(t: ModTarget) => void>()
const early: ModTarget[] = []
const EARLY = 8

const told = (): void => {
  for (const w of watchers) w()
}

const watch = (w: () => void): (() => void) => {
  watchers.add(w)
  return () => void watchers.delete(w)
}

function mount(): void {
  const View = view
  if (View && surface !== "idle") root.render(<View />)
}

function rest(shown: boolean): void {
  const View = view
  if (surface !== "idle") return
  rests++
  root.render(shown && View ? <View key={rests} /> : null)
}

const minutes = (after: unknown): number => Math.min(IDLE_MAX_MINUTES, Math.max(0, Math.round(Number(after) || 0)))

function asked(need: string, call: string): void {
  if (!needs.has(need)) throw new Error(`${call}() needs "${need}" in mod.json's needs`)
}

function listed<T extends { title: string }>(list: Map<string, T>): { id: string; title: string }[] {
  return [...list].map(([id, c]) => ({ id, title: c.title }))
}

function terminal(call: string, op: TerminalOp): Promise<unknown> {
  asked("terminal", call)
  if (surface !== "main") return Promise.reject(new Error(`${call}() works in the mod's main frame, not its sidebar`))
  return request((id) => ({ type: "terminal", id, ...op }))
}

const terminals = async (): Promise<ModTerminal[]> => (await terminal("terminals", { op: "list" })) as ModTerminal[]

const focusTerminal = async (to: string | { room: string; agent: string }): Promise<void> => {
  await terminal("focusTerminal", typeof to === "string" ? { op: "focus", seat: to } : { op: "focus", room: String(to.room), agent: String(to.agent) })
}

function onTerminals(listen: (list: ModTerminal[]) => void): () => void {
  asked("terminal", "onTerminals")
  if (surface !== "main") return () => undefined
  placed.add(listen)
  return () => void placed.delete(listen)
}

const markTerminal = async (seat: string, mark: Partial<ModTerminalMark> | null): Promise<void> => {
  await terminal("markTerminal", { op: "mark", seat: String(seat), mark: mark === null ? null : { asks: mark.asks ?? 0, tasks: mark.tasks ?? [] } })
}

function Button({ children, onClick, kind, disabled }: { children: ReactNode; onClick?: () => void; kind?: "primary" | "quiet" | "danger"; disabled?: boolean }) {
  return (
    <button type="button" className={kind ? `btn is-${kind}` : "btn"} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

function Row({ title, sub, onClick }: { title: ReactNode; sub?: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <span className="mod-row-title">{title}</span>
      {sub && <span className="mod-row-sub">{sub}</span>}
    </>
  )
  return onClick ? (
    <button type="button" className="mod-row" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="mod-row">{body}</div>
  )
}

const api = {
  panel({ title, render }: { title: string; render: ComponentType }): void {
    asked("panel", "panel")
    if (surface !== "main") return
    view = render
    post({ type: "panel", title: String(title) })
    mount()
  },
  sidebar({ title, render }: { title: string; render: ComponentType }): void {
    asked("sidebar", "sidebar")
    if (surface !== "sidebar") return
    view = render
    post({ type: "sidebar", title: String(title) })
    mount()
    sized ??= new ResizeObserver(() => {
      if (innerWidth > 0) post({ type: "size", height: Math.ceil(box.getBoundingClientRect().height) })
    })
    sized.observe(box)
  },
  command({ id, title, run }: { id: string; title: string; run: () => void | Promise<void> }): void {
    asked("command", "command")
    if (surface !== "main") return
    commands.set(String(id), { title: String(title), run })
    post({ type: "commands", list: listed(commands) })
  },
  messageAction({ id, title, run }: { id: string; title: string; run: (message: ModMessage) => void | Promise<void> }): void {
    asked("message-action", "messageAction")
    if (surface !== "main") return
    actions.set(String(id), { title: String(title), run })
    post({ type: "actions", list: listed(actions) })
  },
  tab({ title, render, shown = true, alert = null, hint = null }: { title: string; render: ComponentType; shown?: boolean; alert?: string | null; hint?: string | null }): void {
    asked("tab", "tab")
    if (surface !== "tab") return
    view = render
    tabState = { title: String(title), shown: shown !== false, alert, hint }
    post({ type: "tab", ...tabState })
    mount()
  },
  showTab(next: { shown?: boolean; alert?: string | null; hint?: string | null }): void {
    asked("tab", "showTab")
    if (surface !== "tab" || !tabState) return
    tabState = { ...tabState, ...next, shown: next.shown ?? tabState.shown }
    post({ type: "tab", ...tabState })
  },
  github(): ModGithub | null {
    asked("github", "github")
    return github
  },
  useGithub(): ModGithub | null {
    asked("github", "useGithub")
    return React.useSyncExternalStore(watch, () => github)
  },
  open(to: ModOpen | { kind: "channel"; code: string }): void {
    if (to.kind === "channel") {
      asked("channels", "open")
      post({ type: "channel", code: String(to.code) })
      return
    }
    asked("github", "open")
    post({ type: "open", to })
  },
  idle({ after, backdrop = null, render }: { after: number | null; backdrop?: "meadow" | null; render: ComponentType }): void {
    asked("idle", "idle")
    if (surface !== "idle") return
    view = render
    post({ type: "idle", after: minutes(after), backdrop: backdrop === "meadow" ? "meadow" : null })
  },
  leave(): void {
    asked("idle", "leave")
    if (surface === "idle") post({ type: "leave" })
  },
  useStill(): boolean {
    return React.useSyncExternalStore(watch, () => still)
  },
  channels(): ModChannel[] | null {
    asked("channels", "channels")
    return channelList
  },
  useChannels(): ModChannel[] | null {
    asked("channels", "useChannels")
    return React.useSyncExternalStore(watch, () => channelList)
  },
  show(target: ModTarget): void {
    asked("panel", "show")
    post({ type: "show", target })
  },
  onShow(run: (t: ModTarget) => void): () => void {
    onShows.add(run)
    for (const t of early.splice(0)) run(t)
    return () => void onShows.delete(run)
  },
  useShowing(): ModTarget | null {
    return React.useSyncExternalStore(watch, () => showing)
  },
  title(title: string): void {
    asked("panel", "title")
    if (surface === "main" && view) post({ type: "panel", title: String(title) })
  },
  copy,
  render(kind: string, draw: Draw): void {
    asked(`render:${kind}`, "render")
    drawers.set(String(kind), draw)
  },
  fetch: modFetch,
  terminals,
  onTerminals,
  focusTerminal,
  markTerminal,
  settings: (): Readonly<Record<string, string | boolean | null>> => values,
  Avatar,
  Count,
  Dot,
  Heading,
  Track,
  ago,
  cx,
  Button,
  Field,
  Row,
  Icon,
  List,
  Detail,
  Form,
  Action,
  Actions,
  Empty,
  Toast,
  useFetch,
  storage,
} satisfies { [K in keyof typeof Kit]: K extends Shaped ? unknown : (typeof Kit)[K] }

try {
  Object.defineProperty(window, "open", {
    configurable: true,
    value: (url?: string | URL) => {
      if (url) openUrl(String(url))
      return null
    },
  })
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => copy(text) } })
} catch {
  // A browser that won't let the frame swap these keeps its own: links and copying then do nothing in mods.
}

Object.assign(globalThis, {
  __kiwiMod: {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "react/jsx-dev-runtime": jsxRuntime,
    "react-dom": ReactDOM,
    "react-dom/client": ReactDOMClient,
    "@kiwi/mod": api,
  },
})

function draw(shown: Shown | undefined, dark: boolean): void {
  const drawer = shown && drawers.get(shown.kind)
  if (!shown || !drawer) throw new Error(`the mod has no render("${shown?.kind ?? "?"}") to draw this`)
  const node = drawer({ ...shown, dark })
  if (node !== undefined && node !== null) root.render(node)
}

function theme(vars: Record<string, string>, dark: boolean, calm: boolean): void {
  const s = document.documentElement.style
  for (const [k, v] of Object.entries(vars)) if (k.startsWith("--")) s.setProperty(k, v)
  document.documentElement.dataset["theme"] = dark ? "dark" : "light"
  if (calm) document.documentElement.dataset["motion"] = "reduced"
  else delete document.documentElement.dataset["motion"]
  if (calm !== still) {
    still = calm
    told()
  }
}

const linkOf = (e: MouseEvent): string | null => {
  const a = e.target instanceof Element ? e.target.closest("a[href]") : null
  const href = a instanceof HTMLAnchorElement ? a.href : null
  return href && /^https?:/.test(href) ? href : null
}

const outside = (e: MouseEvent): void => {
  if (e.defaultPrevented || (e.type === "auxclick" && e.button !== 1)) return
  const url = linkOf(e)
  if (!url) return
  e.preventDefault()
  openUrl(url)
}

addEventListener("click", outside)
addEventListener("auxclick", outside)
addEventListener("error", (e) => failed(e.error ?? e.message))
addEventListener("unhandledrejection", (e) => failed(e.reason))
addEventListener("message", (e) => {
  if (e.source !== parent) return
  const m = e.data as ToFrame | null
  if (!m || m.kiwi !== MOD_PROTOCOL) return
  if (m.type === "boot") {
    if (booted) return
    booted = true
    surface = m.surface
    needs = new Set(m.needs)
    values = Object.freeze(m.surface === "render" ? {} : { ...m.settings })
    document.documentElement.dataset["surface"] = surface
    theme(m.theme, m.dark, m.still === true)
    try {
      new Function(m.code)()
      if (m.surface === "render") draw(m.shown, m.dark)
      post({ type: "ready" })
    } catch (err) {
      failed(err)
    }
  } else if (m.type === "theme") theme(m.theme, m.dark, m.still === true)
  else if (m.type === "channels") {
    channelList = needs.has("channels") ? m.list : null
    told()
  } else if (m.type === "rest") rest(m.shown)
  else if (m.type === "github") {
    github = needs.has("github") ? m.data : null
    told()
  } else if (m.type === "showing") {
    showing = m.target
    told()
  } else if (m.type === "show") {
    if (onShows.size) for (const run of onShows) run(m.target)
    else {
      early.push(m.target)
      early.splice(0, Math.max(0, early.length - EARLY))
    }
  } else if (m.type === "command") void Promise.resolve(commands.get(m.id)?.run()).catch(failed)
  else if (m.type === "action") void Promise.resolve(actions.get(m.id)?.run(m.message)).catch(failed)
  else if (m.type === "terminals")
    for (const listen of placed)
      try {
        listen(m.list)
      } catch (err) {
        failed(err)
      }
  else replied(m)
})

post({ type: "hello" })
