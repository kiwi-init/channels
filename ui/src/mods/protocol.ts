import type { ModTerminal as PlacedTerminal, ModTerminalMark } from "../../../desktop/src/bridge.ts"

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

export type Surface = "main" | "sidebar" | "render"

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

export type TerminalOp = { op: "list" } | { op: "focus"; seat: string } | { op: "focus"; room: string; agent: string } | { op: "mark"; seat: string; mark: ModTerminalMark | null }

export interface ModFetchResult {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}

export type ToFrame =
  | { kiwi: typeof MOD_PROTOCOL; type: "boot"; name: string; surface: Surface; needs: string[]; code: string; theme: Record<string, string>; dark: boolean; shown?: Shown }
  | { kiwi: typeof MOD_PROTOCOL; type: "theme"; theme: Record<string, string>; dark: boolean }
  | { kiwi: typeof MOD_PROTOCOL; type: "command"; id: string }
  | { kiwi: typeof MOD_PROTOCOL; type: "action"; id: string; message: ModMessage }
  | { kiwi: typeof MOD_PROTOCOL; type: "terminals"; list: ModTerminal[] }
  | { kiwi: typeof MOD_PROTOCOL; type: "reply"; id: number; ok: true; value: ModFetchResult | ModTerminal[] | null }
  | { kiwi: typeof MOD_PROTOCOL; type: "reply"; id: number; ok: false; error: string }

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
  | ({ kiwi: typeof MOD_PROTOCOL; type: "terminal"; id: number } & TerminalOp)

const GATED: { readonly [K in FromFrame["type"]]?: readonly [need: string, from: Surface] } = {
  panel: ["panel", "main"],
  commands: ["command", "main"],
  actions: ["message-action", "main"],
  sidebar: ["sidebar", "sidebar"],
  size: ["sidebar", "sidebar"],
  terminal: ["terminal", "main"],
}

export function heeded(type: FromFrame["type"], from: Surface, mod: { state: string; needs: readonly string[] } | undefined): boolean {
  const gate = GATED[type]
  return !gate || (gate[1] === from && !!mod && mod.state === "on" && mod.needs.includes(gate[0]))
}

const short = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max

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
    case "size": {
      const h = m["height"]
      return typeof h === "number" && Number.isFinite(h) && h >= 0 ? { kiwi: MOD_PROTOCOL, type: "size", height: Math.round(Math.min(Math.max(h, SIDE_HEIGHT.min), SIDE_HEIGHT.max)) } : null
    }
    case "commands":
    case "actions": {
      const list = named(m["list"], m["type"] === "commands" ? 50 : 10)
      return list ? { kiwi: MOD_PROTOCOL, type: m["type"], list } : null
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
