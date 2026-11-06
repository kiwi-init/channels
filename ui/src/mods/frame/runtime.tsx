import * as React from "react"
import * as ReactDOM from "react-dom"
import * as ReactDOMClient from "react-dom/client"
import * as jsxRuntime from "react/jsx-runtime"
import type { ComponentType, ReactNode } from "react"

import "~/styles/tokens.css"
import "~/styles/base.css"
import "~/mods/frame/frame.css"
import { Field } from "~/kit/form"
import { Icon } from "~/kit/icons"
import { MOD_PROTOCOL, type FromFrame, type ModFetchResult, type ModMessage, type ModTerminal, type ModTerminalMark, type Shown, type Surface, type TerminalOp, type ToFrame } from "~/mods/protocol"

type Waiting = { resolve: (r: unknown) => void; reject: (e: Error) => void }

type Draw = (shown: Shown & { dark: boolean }) => ReactNode | void

type Out = { [K in FromFrame["type"]]: Omit<Extract<FromFrame, { type: K }>, "kiwi"> }[FromFrame["type"]]

const post = (m: Out): void => parent.postMessage({ kiwi: MOD_PROTOCOL, ...m }, "*")

let view: ComponentType | null = null
let booted = false
let surface: Surface = "main"
let needs: ReadonlySet<string> = new Set()
let values: Readonly<Record<string, string | boolean | null>> = Object.freeze({})
let nextId = 1
const waiting = new Map<number, Waiting>()
const commands = new Map<string, { title: string; run: () => void | Promise<void> }>()
const actions = new Map<string, { title: string; run: (message: ModMessage) => void | Promise<void> }>()
const drawers = new Map<string, Draw>()
const box = document.getElementById("root") ?? document.body.appendChild(document.createElement("div"))
const root = ReactDOMClient.createRoot(box)
let sized: ResizeObserver | null = null

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
  render(kind: string, draw: Draw): void {
    asked(`render:${kind}`, "render")
    drawers.set(String(kind), draw)
  },
  fetch: modFetch,
  terminals,
  focusTerminal,
  markTerminal,
  settings: (): Readonly<Record<string, string | boolean | null>> => values,
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

function draw(shown: Shown | undefined, dark: boolean): void {
  const drawer = shown && drawers.get(shown.kind)
  if (!shown || !drawer) throw new Error(`the mod has no render("${shown?.kind ?? "?"}") to draw this`)
  const node = drawer({ ...shown, dark })
  if (node !== undefined && node !== null) root.render(node)
}

function theme(vars: Record<string, string>, dark: boolean): void {
  const s = document.documentElement.style
  for (const [k, v] of Object.entries(vars)) if (k.startsWith("--")) s.setProperty(k, v)
  document.documentElement.dataset["theme"] = dark ? "dark" : "light"
}

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
    values = Object.freeze({ ...m.settings })
    document.documentElement.dataset["surface"] = surface
    theme(m.theme, m.dark)
    try {
      new Function(m.code)()
      if (surface === "render") draw(m.shown, m.dark)
      post({ type: "ready" })
    } catch (err) {
      failed(err)
    }
  } else if (m.type === "theme") theme(m.theme, m.dark)
  else if (m.type === "command") void Promise.resolve(commands.get(m.id)?.run()).catch(failed)
  else if (m.type === "action") void Promise.resolve(actions.get(m.id)?.run(m.message)).catch(failed)
  else if (m.type === "reply") {
    const w = waiting.get(m.id)
    waiting.delete(m.id)
    if (m.ok) w?.resolve(m.value)
    else w?.reject(new Error(m.error))
  }
})

post({ type: "hello" })
