import type { Where } from "~/model"

export type Tab = "chat" | "specs" | "tasks" | "agents" | "needs" | "github" | "threads"

export interface Spot {
  seq: number
  offset: number
}

export interface Kept {
  where: Where
  tab: Tab
}

const SPOTS = "mc.spots"
const PLACES = "mc.places"
const KEEP = 200
const WRITE_MS = 500
const TABS: readonly Tab[] = ["chat", "specs", "tasks", "agents", "github", "threads"]

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)

export function whereOf(x: unknown): Where | null {
  if (!isRecord(x)) return null
  if (x.kind === "room" && typeof x.room === "string" && x.room) return { kind: "room", room: x.room }
  if (x.kind === "dm" && typeof x.with === "string" && x.with) return { kind: "dm", with: x.with }
  if (x.kind === "task" && typeof x.task === "number" && Number.isSafeInteger(x.task)) return { kind: "task", task: x.task }
  const b = x.between
  if (x.kind === "theirs" && Array.isArray(b) && b.length === 2 && typeof b[0] === "string" && typeof b[1] === "string") return { kind: "theirs", between: [b[0], b[1]] }
  return null
}

function spotOf(x: unknown): Spot | null {
  if (!isRecord(x) || typeof x.seq !== "number" || typeof x.offset !== "number") return null
  return Number.isSafeInteger(x.seq) && Number.isFinite(x.offset) ? { seq: x.seq, offset: x.offset } : null
}

function keptOf(x: unknown): Kept | null {
  if (!isRecord(x)) return null
  const where = whereOf(x.where)
  const tab = TABS.find((t) => t === x.tab) ?? "chat"
  return where ? { where, tab } : null
}

function read<T>(key: string, parse: (x: unknown) => T | null): Map<string, T> {
  const out = new Map<string, T>()
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "[]")
    if (!Array.isArray(raw)) return out
    for (const pair of raw) {
      if (!Array.isArray(pair) || typeof pair[0] !== "string") continue
      const value = parse(pair[1])
      if (value) out.set(pair[0], value)
    }
  } catch {
    // Blocked storage or a damaged entry: start with nothing remembered.
  }
  return out
}

function store<T>(key: string, parse: (x: unknown) => T | null) {
  let all: Map<string, T> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const loaded = (): Map<string, T> => (all ??= read(key, parse))
  const write = () => {
    timer = null
    try {
      localStorage.setItem(key, JSON.stringify([...loaded()].slice(-KEEP)))
    } catch {
      // Blocked storage or a full disk: this launch still remembers it in memory.
    }
  }
  const flush = () => {
    if (timer === null) return
    clearTimeout(timer)
    write()
  }
  if (typeof addEventListener === "function") addEventListener("pagehide", flush)
  return {
    get: (k: string): T | undefined => loaded().get(k),
    set: (k: string, value: T | null) => {
      const map = loaded()
      if (value === null && !map.has(k)) return
      map.delete(k)
      if (value !== null) map.set(k, value)
      timer ??= setTimeout(write, WRITE_MS)
    },
  }
}

const spots = store(SPOTS, spotOf)
const places = store(PLACES, keptOf)

export const whereKey = (w: Where): string => (w.kind === "room" ? `r:${w.room}` : w.kind === "dm" ? `d:${w.with}` : w.kind === "theirs" ? `p:${w.between.join("&")}` : `t:${w.task}`)

export const spotKey = (code: string, where: Where): string => `${code}\n${whereKey(where)}`

export const spotAt = (key: string): Spot | null => spots.get(key) ?? null

export const keepSpot = (key: string, spot: Spot | null): void => spots.set(key, spot)

export const keptPlace = (code: string): Kept | null => places.get(code) ?? null

export const keepPlace = (code: string, kept: Kept): void => places.set(code, kept)
