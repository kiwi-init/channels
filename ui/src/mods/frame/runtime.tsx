import * as React from "react"
import * as ReactDOM from "react-dom"
import * as ReactDOMClient from "react-dom/client"
import * as jsxRuntime from "react/jsx-runtime"
import type { ComponentType, ReactNode } from "react"

import "~/styles/tokens.css"
import "~/styles/base.css"
import "~/mods/frame/frame.css"
import { Avatar, Count, cx, Dot, Heading } from "~/kit/bits"
import { Empty } from "~/kit/empty"
import { Field } from "~/kit/form"
import { Track } from "~/kit/glide"
import { ago } from "~/kit/time"
import { Icon } from "~/mods/frame/glyphs"
import { MOD_PROTOCOL, type FromFrame, type ModFetchResult, type ModGithub, type ModMessage, type ModOpen, type ModTarget, type ModTerminal, type ModTerminalMark, type Surface, type TerminalOp, type ToFrame } from "~/mods/protocol"

type Waiting = { resolve: (r: unknown) => void; reject: (e: Error) => void }

type Out = { [K in FromFrame["type"]]: Omit<Extract<FromFrame, { type: K }>, "kiwi"> }[FromFrame["type"]]

const post = (m: Out): void => parent.postMessage({ kiwi: MOD_PROTOCOL, ...m }, "*")

let view: ComponentType | null = null
let booted = false
let surface: Surface = "main"
let needs: ReadonlySet<string> = new Set()
let nextId = 1
const waiting = new Map<number, Waiting>()
const commands = new Map<string, { title: string; run: () => void | Promise<void> }>()
const actions = new Map<string, { title: string; run: (message: ModMessage) => void | Promise<void> }>()
const box = document.getElementById("root") ?? document.body.appendChild(document.createElement("div"))
const root = ReactDOMClient.createRoot(box)
let sized: ResizeObserver | null = null
let github: ModGithub | null = null
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

function failed(e: unknown): void {
  const said = String(e)
  const stack = e instanceof Error ? (e.stack ?? "") : ""
  post({ type: "error", message: stack.startsWith(said) ? stack : `${said}\n${stack}`.trim() })
}

function mount(): void {
  const View = view
  if (View) root.render(<View />)
}

function asked(need: string, call: string): void {
  if (!needs.has(need)) throw new Error(`${call}() needs "${need}" in mod.json's needs`)
}

function listed<T extends { title: string }>(list: Map<string, T>): { id: string; title: string }[] {
  return [...list].map(([id, c]) => ({ id, title: c.title }))
}

function bytes(b64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function modFetch(input: string | URL, init: { method?: string; headers?: HeadersInit; body?: string | null } = {}): Promise<Response> {
  if (init.body !== undefined && init.body !== null && typeof init.body !== "string") throw new TypeError("a mod's fetch sends a string body")
  const id = nextId++
  const reply = new Promise<unknown>((resolve, reject) => waiting.set(id, { resolve, reject }))
  post({ type: "fetch", id, url: String(input), init: { method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body ?? null } })
  const r = (await reply) as ModFetchResult
  const empty = r.status === 204 || r.status === 304 || (init.method ?? "GET").toUpperCase() === "HEAD"
  return new Response(empty ? null : bytes(r.body), { status: r.status, statusText: r.statusText, headers: r.headers })
}

function terminal(call: string, op: TerminalOp): Promise<unknown> {
  asked("terminal", call)
  if (surface !== "main") return Promise.reject(new Error(`${call}() works in the mod's main frame, not its sidebar`))
  const id = nextId++
  const reply = new Promise<unknown>((resolve, reject) => waiting.set(id, { resolve, reject }))
  post({ type: "terminal", id, ...op })
  return reply
}

const terminals = async (): Promise<ModTerminal[]> => (await terminal("terminals", { op: "list" })) as ModTerminal[]

const focusTerminal = async (seat: string): Promise<void> => {
  await terminal("focusTerminal", { op: "focus", seat: String(seat) })
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
  open(to: ModOpen): void {
    asked("github", "open")
    post({ type: "open", to })
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
  copy(text: string, note?: string): void {
    post({ type: "copy", text: String(text), note: note === undefined ? null : String(note) })
  },
  fetch: modFetch,
  terminals,
  focusTerminal,
  markTerminal,
  Avatar,
  Count,
  Dot,
  Empty,
  Heading,
  Track,
  ago,
  cx,
  Button,
  Field,
  Row,
  Icon,
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

function theme(vars: Record<string, string>, dark: boolean): void {
  const s = document.documentElement.style
  for (const [k, v] of Object.entries(vars)) if (k.startsWith("--")) s.setProperty(k, v)
  document.documentElement.dataset["theme"] = dark ? "dark" : "light"
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
  post({ type: "link", url })
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
    document.documentElement.dataset["surface"] = surface
    theme(m.theme, m.dark)
    try {
      new Function(m.code)()
      post({ type: "ready" })
    } catch (err) {
      failed(err)
    }
  } else if (m.type === "theme") theme(m.theme, m.dark)
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
  else if (m.type === "reply") {
    const w = waiting.get(m.id)
    waiting.delete(m.id)
    if (m.ok) w?.resolve(m.value)
    else w?.reject(new Error(m.error))
  }
})

post({ type: "hello" })
