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
import { Field } from "~/kit/form"
import { Icon } from "~/kit/icons"
import { Action, Actions, Detail, Empty, Form, List, useFetch } from "~/mods/frame/kit"
import { copy, failed, modFetch, openUrl, post, replied, request, storage, Toast } from "~/mods/frame/wire"
import { MOD_PROTOCOL, type ModMessage, type ModTerminal, type ModTerminalMark, type Shown, type Surface, type TerminalOp, type ToFrame } from "~/mods/protocol"

type Draw = (shown: Shown & { dark: boolean }) => ReactNode | void

let view: ComponentType | null = null
let booted = false
let surface: Surface = "main"
let needs: ReadonlySet<string> = new Set()
const commands = new Map<string, { title: string; run: () => void | Promise<void> }>()
const actions = new Map<string, { title: string; run: (message: ModMessage) => void | Promise<void> }>()
const drawers = new Map<string, Draw>()
const box = document.getElementById("root") ?? document.body.appendChild(document.createElement("div"))
const root = ReactDOMClient.createRoot(box)
let sized: ResizeObserver | null = null

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

function terminal(call: string, op: TerminalOp): Promise<unknown> {
  asked("terminal", call)
  if (surface !== "main") return Promise.reject(new Error(`${call}() works in the mod's main frame, not its sidebar`))
  return request((id) => ({ type: "terminal", id, ...op }))
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
} satisfies typeof Kit

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
  else replied(m)
})

post({ type: "hello" })
