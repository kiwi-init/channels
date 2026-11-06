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

export type Surface = "main" | "sidebar"

export interface ModCommand {
  id: string
  title: string
}

export interface ModMessage {
  seq: number
  text: string
  author: string
  at: number
  room: string | null
  link: string
}

export const SIDE_HEIGHT = { min: 24, max: 320 }

interface ModFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string | null
}

export interface ModFetchResult {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}

export type ToFrame =
  | { kiwi: typeof MOD_PROTOCOL; type: "boot"; name: string; surface: Surface; needs: string[]; code: string; theme: Record<string, string>; dark: boolean }
  | { kiwi: typeof MOD_PROTOCOL; type: "theme"; theme: Record<string, string>; dark: boolean }
  | { kiwi: typeof MOD_PROTOCOL; type: "command"; id: string }
  | { kiwi: typeof MOD_PROTOCOL; type: "action"; id: string; message: ModMessage }
  | { kiwi: typeof MOD_PROTOCOL; type: "reply"; id: number; ok: true; value: ModFetchResult }
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

const GATED: { readonly [K in FromFrame["type"]]?: readonly [need: string, from: Surface] } = {
  panel: ["panel", "main"],
  commands: ["command", "main"],
  actions: ["message-action", "main"],
  sidebar: ["sidebar", "sidebar"],
  size: ["sidebar", "sidebar"],
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
    default:
      return null
  }
}
