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
import { MOD_PROTOCOL, type FromFrame, type ModFetchResult, type ToFrame } from "~/mods/protocol"

type Waiting = { resolve: (r: ModFetchResult) => void; reject: (e: Error) => void }

type Out = { [K in FromFrame["type"]]: Omit<Extract<FromFrame, { type: K }>, "kiwi"> }[FromFrame["type"]]

const post = (m: Out): void => parent.postMessage({ kiwi: MOD_PROTOCOL, ...m }, "*")

let view: ComponentType | null = null
let booted = false
let nextId = 1
const waiting = new Map<number, Waiting>()
const commands = new Map<string, { title: string; run: () => void | Promise<void> }>()
const root = ReactDOMClient.createRoot(document.getElementById("root") ?? document.body.appendChild(document.createElement("div")))

function failed(e: unknown): void {
  post({ type: "error", message: e instanceof Error ? (e.stack ?? e.message) : String(e) })
}

function mount(): void {
  const View = view
  if (View) root.render(<View />)
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
  const reply = new Promise<ModFetchResult>((resolve, reject) => waiting.set(id, { resolve, reject }))
  post({ type: "fetch", id, url: String(input), init: { method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body ?? null } })
  const r = await reply
  const empty = r.status === 204 || r.status === 304 || (init.method ?? "GET").toUpperCase() === "HEAD"
  return new Response(empty ? null : bytes(r.body), { status: r.status, statusText: r.statusText, headers: r.headers })
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
    view = render
    post({ type: "panel", title: String(title) })
    mount()
  },
  command({ id, title, run }: { id: string; title: string; run: () => void | Promise<void> }): void {
    commands.set(String(id), { title: String(title), run })
    post({ type: "commands", list: [...commands].map(([cid, c]) => ({ id: cid, title: c.title })) })
  },
  fetch: modFetch,
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

addEventListener("error", (e) => failed(e.error ?? e.message))
addEventListener("unhandledrejection", (e) => failed(e.reason))
addEventListener("message", (e) => {
  if (e.source !== parent) return
  const m = e.data as ToFrame | null
  if (!m || m.kiwi !== MOD_PROTOCOL) return
  if (m.type === "boot") {
    if (booted) return
    booted = true
    theme(m.theme, m.dark)
    try {
      new Function(m.code)()
      post({ type: "ready" })
    } catch (err) {
      failed(err)
    }
  } else if (m.type === "theme") theme(m.theme, m.dark)
  else if (m.type === "command") void Promise.resolve(commands.get(m.id)?.run()).catch(failed)
  else if (m.type === "reply") {
    const w = waiting.get(m.id)
    waiting.delete(m.id)
    if (m.ok) w?.resolve(m.value)
    else w?.reject(new Error(m.error))
  }
})

post({ type: "hello" })
