import type { GithubHealth } from "@kiwi/core/github-health.ts"

import type { ModTerminal as PlacedTerminal, ModTerminalMark } from "../../../desktop/src/bridge.ts"
import type { Issue, Person, PullRequest, Task } from "~/model"

export type { ModTerminalMark, PlacedTerminal }

export interface ModTerminal extends PlacedTerminal {
  waits: ModTerminalMark
}

export const MOD_PROTOCOL = 1

export const LOOK = [
  "bg",
  "bg-2",
  "bg-3",
  "ink",
  "ink-2",
  "ink-3",
  "line",
  "line-2",
  "line-3",
  "wash",
  "wash-2",
  "scrim",
  "link",
  "on-ink",
  "accent",
  "accent-wash",
  "live",
  "doing",
  "review",
  "decide",
  "decide-wash",
  "alert",
  "alert-wash",
  "c-red",
  "c-orange",
  "c-yellow",
  "c-green",
  "c-teal",
  "c-blue",
  "c-indigo",
  "c-violet",
  "c-pink",
  "c-brown",
]

export type Surface = "main" | "sidebar" | "tab" | "idle" | "render"

export type ModTarget = { kind: "pr" | "issue"; repo: string; number: number } | { kind: "view"; view: string }

export type ModOpen = { kind: "task"; id: number } | { kind: "settings" } | { kind: "chat" }

export interface ModChannel {
  code: string
  title: string
  needs: number
  last: number
  line: string | null
}

export const IDLE_MAX_MINUTES = 120

export type ModPerson = Pick<Person, "name" | "kind" | "harness" | "presence" | "color" | "picture" | "face" | "activity" | "load" | "red" | "doneAt">

export interface ModTask {
  id: number
  title: string
  status: Task["status"]
  owner: { nickname: string; person: ModPerson | null } | null
}

export interface ModGithub {
  repos: string[]
  prs: PullRequest[]
  issues: Issue[]
  tasks: ModTask[]
  health: GithubHealth | null
}

export interface ModCommand {
  id: string
  title: string
}

export interface ModMessage {
  seq: number
  text: string
  author: string
  from: string
  channelId: string
  at: number
  room: string | null
  link: string
}

export const SIDE_HEIGHT = { min: 24, max: 320 }

export interface Shown {
  kind: string
  name: string
  html: string
  full: boolean
}

interface ModFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string | null
}

export type StorageOp = "get" | "set" | "remove" | "keys"

export type ToastStyle = "success" | "failure"

export const STORAGE = { key: 200, value: 256_000, total: 1_000_000 }

export type TerminalOp = { op: "list" } | { op: "focus"; seat: string } | { op: "focus"; room: string; agent: string } | { op: "mark"; seat: string; mark: ModTerminalMark | null }

export interface ModFetchResult {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}

export type ToFrame =
  | {
      kiwi: typeof MOD_PROTOCOL
      type: "boot"
      name: string
      surface: Exclude<Surface, "render">
      needs: string[]
      code: string
      settings: Record<string, string | boolean | null>
      theme: Record<string, string>
      dark: boolean
      still: boolean
    }
  | {
      kiwi: typeof MOD_PROTOCOL
      type: "boot"
      name: string
      surface: "render"
      needs: string[]
      code: string
      theme: Record<string, string>
      dark: boolean
      still: boolean
      shown: Shown
    }
  | { kiwi: typeof MOD_PROTOCOL; type: "theme"; theme: Record<string, string>; dark: boolean; still: boolean }
  | { kiwi: typeof MOD_PROTOCOL; type: "command"; id: string }
  | { kiwi: typeof MOD_PROTOCOL; type: "action"; id: string; message: ModMessage }
  | { kiwi: typeof MOD_PROTOCOL; type: "terminals"; list: ModTerminal[] }
  | { kiwi: typeof MOD_PROTOCOL; type: "reply"; id: number; ok: true; value: ModFetchResult | ModTerminal[] | null }
  | { kiwi: typeof MOD_PROTOCOL; type: "reply"; id: number; ok: false; error: string }
  | { kiwi: typeof MOD_PROTOCOL; type: "stored"; id: number; ok: true; value: string | string[] | null }
  | { kiwi: typeof MOD_PROTOCOL; type: "stored"; id: number; ok: false; error: string }
  | { kiwi: typeof MOD_PROTOCOL; type: "github"; data: ModGithub | null }
  | { kiwi: typeof MOD_PROTOCOL; type: "show"; target: ModTarget }
  | { kiwi: typeof MOD_PROTOCOL; type: "showing"; target: ModTarget | null }
  | { kiwi: typeof MOD_PROTOCOL; type: "channels"; list: ModChannel[] }
  | { kiwi: typeof MOD_PROTOCOL; type: "rest"; shown: boolean }
  | { kiwi: typeof MOD_PROTOCOL; type: "rooms"; list: ModRoomGrant[] }

export type FromFrame =
  | { kiwi: typeof MOD_PROTOCOL; type: "hello" }
  | { kiwi: typeof MOD_PROTOCOL; type: "ready" }
  | { kiwi: typeof MOD_PROTOCOL; type: "error"; message: string }
  | { kiwi: typeof MOD_PROTOCOL; type: "panel"; title: string }
  | { kiwi: typeof MOD_PROTOCOL; type: "commands"; list: ModCommand[] }
  | { kiwi: typeof MOD_PROTOCOL; type: "sidebar"; title: string }
  | { kiwi: typeof MOD_PROTOCOL; type: "size"; height: number }
  | { kiwi: typeof MOD_PROTOCOL; type: "actions"; list: ModCommand[] }
  | { kiwi: typeof MOD_PROTOCOL; type: "fetch"; id: number; url: string; init: ModFetchInit }
  | { kiwi: typeof MOD_PROTOCOL; type: "storage"; id: number; op: StorageOp; key: string | null; value: string | null }
  | { kiwi: typeof MOD_PROTOCOL; type: "toast"; title: string; message: string | null; style: ToastStyle | null }
  | ({ kiwi: typeof MOD_PROTOCOL; type: "terminal"; id: number } & TerminalOp)
  | { kiwi: typeof MOD_PROTOCOL; type: "tab"; title: string; shown: boolean; alert: string | null; hint: string | null }
  | { kiwi: typeof MOD_PROTOCOL; type: "open"; to: ModOpen }
  | { kiwi: typeof MOD_PROTOCOL; type: "channel"; code: string }
  | { kiwi: typeof MOD_PROTOCOL; type: "idle"; after: number; backdrop: "meadow" | null }
  | { kiwi: typeof MOD_PROTOCOL; type: "leave" }
  | { kiwi: typeof MOD_PROTOCOL; type: "show"; target: ModTarget }
  | { kiwi: typeof MOD_PROTOCOL; type: "copy"; text: string; note: string | null }
  | { kiwi: typeof MOD_PROTOCOL; type: "link"; url: string }
  | { kiwi: typeof MOD_PROTOCOL; type: "post"; id: number; code: string; room: string; text: string }

const short = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max

export interface ModRoomGrant {
  channel: string
  title: string
  room: string
}

export const POST_CHARS = 4_000
export const POST_EVERY_MS = 2_000

const ANY: readonly Surface[] = ["main", "sidebar", "tab"]

const GATED: { readonly [K in FromFrame["type"]]?: readonly [need: string, from: readonly Surface[]] } = {
  panel: ["panel", ["main"]],
  commands: ["command", ["main"]],
  actions: ["message-action", ["main"]],
  sidebar: ["sidebar", ["sidebar"]],
  size: ["sidebar", ["sidebar"]],
  terminal: ["terminal", ["main"]],
  tab: ["tab", ["tab"]],
  open: ["github", ANY],
  show: ["panel", ANY],
  channel: ["channels", [...ANY, "idle"]],
  idle: ["idle", ["idle"]],
  leave: ["idle", ["idle"]],
}

const RUNNING: ReadonlySet<FromFrame["type"]> = new Set(["storage", "toast", "copy", "link"])

const FROM_IDLE: ReadonlySet<FromFrame["type"]> = new Set(["hello", "ready", "error", "idle", "leave", "channel"])

export function heeded(type: FromFrame["type"], from: Surface, mod: { state: string; needs: readonly string[] } | undefined): boolean {
  if (from === "idle" && !FROM_IDLE.has(type)) return false
  if (RUNNING.has(type)) return !!mod && mod.state === "on"
  if (type === "post") return ANY.includes(from) && !!mod && mod.state === "on" && mod.needs.some((n) => n.startsWith("post:"))
  const gate = GATED[type]
  return !gate || (gate[1].includes(from) && !!mod && mod.state === "on" && mod.needs.includes(gate[0]))
}

const REPO = /^[\w.-]{1,100}\/[\w.-]{1,100}$/

const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0

export function target(v: unknown): ModTarget | null {
  if (!v || typeof v !== "object") return null
  const t = v as Record<string, unknown>
  if ((t["kind"] === "pr" || t["kind"] === "issue") && typeof t["repo"] === "string" && REPO.test(t["repo"]) && count(t["number"])) return { kind: t["kind"], repo: t["repo"], number: t["number"] }
  if (t["kind"] === "view" && short(t["view"], 32)) return { kind: "view", view: t["view"] }
  return null
}

function opened(v: unknown): ModOpen | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  if (o["kind"] === "task") return count(o["id"]) ? { kind: "task", id: o["id"] } : null
  return o["kind"] === "settings" || o["kind"] === "chat" ? { kind: o["kind"] } : null
}

function webUrl(v: unknown): string | null {
  if (!short(v, 4_000)) return null
  try {
    const u = new URL(v)
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null
  } catch {
    // Not a URL: the frame's link goes nowhere.
    return null
  }
}

export const sameTarget = (a: ModTarget | null, b: ModTarget | null): boolean => JSON.stringify(a) === JSON.stringify(b)

const OPS: ReadonlySet<string> = new Set<StorageOp>(["get", "set", "remove", "keys"])

function named(v: unknown, max: number): ModCommand[] | null {
  if (!Array.isArray(v) || v.length > max) return null
  const out: ModCommand[] = []
  for (const c of v) {
    const { id, title } = (c ?? {}) as Record<string, unknown>
    if (!short(id, 64) || !short(title, 80)) return null
    out.push({ id, title })
  }
  return out
}

export function fromFrame(data: unknown): FromFrame | null {
  if (!data || typeof data !== "object") return null
  const m = data as Record<string, unknown>
  if (m["kiwi"] !== MOD_PROTOCOL) return null
  switch (m["type"]) {
    case "hello":
    case "ready":
      return { kiwi: MOD_PROTOCOL, type: m["type"] }
    case "error":
      return { kiwi: MOD_PROTOCOL, type: "error", message: String(m["message"] ?? "").slice(0, 2_000) || "it threw with no message" }
    case "panel":
      return short(m["title"], 80) ? { kiwi: MOD_PROTOCOL, type: "panel", title: m["title"] } : null
    case "sidebar":
      return short(m["title"], 80) ? { kiwi: MOD_PROTOCOL, type: "sidebar", title: m["title"] } : null
    case "tab":
      return short(m["title"], 40)
        ? { kiwi: MOD_PROTOCOL, type: "tab", title: m["title"], shown: m["shown"] !== false, alert: short(m["alert"], 80) ? m["alert"] : null, hint: short(m["hint"], 200) ? m["hint"] : null }
        : null
    case "open": {
      const to = opened(m["to"])
      return to ? { kiwi: MOD_PROTOCOL, type: "open", to } : null
    }
    case "channel":
      return short(m["code"], 64) ? { kiwi: MOD_PROTOCOL, type: "channel", code: m["code"] } : null
    case "post": {
      const { id, code, room, text } = m
      if (typeof id !== "number" || !Number.isSafeInteger(id) || !short(code, 64) || !short(room, 33) || typeof text !== "string" || text.length > POST_CHARS) return null
      return { kiwi: MOD_PROTOCOL, type: "post", id, code, room: room.replace(/^#/, ""), text }
    }
    case "idle": {
      const after = m["after"]
      if (typeof after !== "number" || !Number.isInteger(after) || after < 0 || after > IDLE_MAX_MINUTES) return null
      return { kiwi: MOD_PROTOCOL, type: "idle", after, backdrop: m["backdrop"] === "meadow" ? "meadow" : null }
    }
    case "leave":
      return { kiwi: MOD_PROTOCOL, type: "leave" }
    case "show": {
      const t = target(m["target"])
      return t ? { kiwi: MOD_PROTOCOL, type: "show", target: t } : null
    }
    case "size": {
      const h = m["height"]
      return typeof h === "number" && Number.isFinite(h) && h >= 0 ? { kiwi: MOD_PROTOCOL, type: "size", height: Math.round(Math.min(Math.max(h, SIDE_HEIGHT.min), SIDE_HEIGHT.max)) } : null
    }
    case "commands":
    case "actions": {
      const list = named(m["list"], m["type"] === "commands" ? 50 : 10)
      return list ? { kiwi: MOD_PROTOCOL, type: m["type"], list } : null
    }
    case "copy":
      return typeof m["text"] === "string" && m["text"].length <= 10_000 ? { kiwi: MOD_PROTOCOL, type: "copy", text: m["text"], note: short(m["note"], 80) ? m["note"] : null } : null
    case "link": {
      const url = webUrl(m["url"])
      return url ? { kiwi: MOD_PROTOCOL, type: "link", url } : null
    }
    case "fetch": {
      const { id, url, init } = m
      if (typeof id !== "number" || !Number.isSafeInteger(id) || !short(url, 4_000)) return null
      const i = (init && typeof init === "object" ? init : {}) as Record<string, unknown>
      const headers: Record<string, string> = {}
      if (i["headers"] && typeof i["headers"] === "object") for (const [k, v] of Object.entries(i["headers"] as Record<string, unknown>)) if (typeof v === "string") headers[k] = v
      return {
        kiwi: MOD_PROTOCOL,
        type: "fetch",
        id,
        url,
        init: { method: typeof i["method"] === "string" ? i["method"] : "GET", headers, body: typeof i["body"] === "string" ? i["body"] : null },
      }
    }
    case "storage": {
      const { id, op, key, value } = m
      if (typeof id !== "number" || !Number.isSafeInteger(id) || typeof op !== "string" || !OPS.has(op)) return null
      if (op !== "keys" && !short(key, STORAGE.key)) return null
      if (op === "set" && (typeof value !== "string" || value.length > STORAGE.value)) return null
      return { kiwi: MOD_PROTOCOL, type: "storage", id, op: op as StorageOp, key: op === "keys" ? null : (key as string), value: op === "set" ? (value as string) : null }
    }
    case "toast": {
      const { title, message, style } = m
      if (!short(title, 200)) return null
      return {
        kiwi: MOD_PROTOCOL,
        type: "toast",
        title,
        message: short(message, 500) ? message : null,
        style: style === "success" || style === "failure" ? style : null,
      }
    }
    case "terminal":
      return terminalOp(m)
    default:
      return null
  }
}

const SEAT = /^[0-9a-f]{16}$/
const ROOM = /^[0-9a-f]{32}$/
const AGENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

function terminalOp(m: Record<string, unknown>): FromFrame | null {
  const { id, op, seat, mark, room, agent } = m
  if (typeof id !== "number" || !Number.isSafeInteger(id)) return null
  const base = { kiwi: MOD_PROTOCOL as typeof MOD_PROTOCOL, type: "terminal" as const, id }
  if (op === "list") return { ...base, op }
  if (op === "focus" && seat === undefined) return typeof room === "string" && ROOM.test(room) && typeof agent === "string" && AGENT.test(agent) ? { ...base, op, room, agent } : null
  if (typeof seat !== "string" || !SEAT.test(seat)) return null
  if (op === "focus") return { ...base, op, seat }
  if (op !== "mark") return null
  if (mark === null) return { ...base, op, seat, mark: null }
  const { asks = 0, tasks = [] } = (mark && typeof mark === "object" ? mark : {}) as Record<string, unknown>
  if (typeof asks !== "number" || !Number.isSafeInteger(asks) || asks < 0 || asks > 999) return null
  if (!Array.isArray(tasks) || tasks.length > 20 || !tasks.every((t) => typeof t === "number" && Number.isSafeInteger(t) && t > 0)) return null
  return { ...base, op, seat, mark: { asks, tasks: tasks as number[] } }
}
