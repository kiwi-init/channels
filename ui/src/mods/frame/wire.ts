import { MOD_PROTOCOL, STORAGE, type FromFrame, type ModFetchResult, type StorageOp, type ToastStyle, type ToFrame } from "~/mods/protocol"

type Out = { [K in FromFrame["type"]]: Omit<Extract<FromFrame, { type: K }>, "kiwi"> }[FromFrame["type"]]

type Waiting<T> = { resolve: (v: T) => void; reject: (e: Error) => void }

let nextId = 1
const replies = new Map<number, Waiting<unknown>>()
const storing = new Map<number, Waiting<string | string[] | null>>()

export const post = (m: Out): void => parent.postMessage({ kiwi: MOD_PROTOCOL, ...m }, "*")

export function failed(e: unknown): void {
  const said = String(e)
  const stack = e instanceof Error ? (e.stack ?? "") : ""
  post({ type: "error", message: stack.startsWith(said) ? stack : `${said}\n${stack}`.trim() })
}

function wait<T>(list: Map<number, Waiting<T>>): [number, Promise<T>] {
  const id = nextId++
  return [id, new Promise<T>((resolve, reject) => list.set(id, { resolve, reject }))]
}

function settle<T>(list: Map<number, Waiting<T>>, id: number, r: { value: T } | { error: string }): void {
  const w = list.get(id)
  list.delete(id)
  if ("error" in r) w?.reject(new Error(r.error))
  else w?.resolve(r.value)
}

export function request(make: (id: number) => Out): Promise<unknown> {
  const [id, reply] = wait(replies)
  post(make(id))
  return reply
}

export function replied(m: ToFrame): void {
  if (m.type === "reply") settle(replies, m.id, m.ok ? { value: m.value } : { error: m.error })
  else if (m.type === "stored") settle(storing, m.id, m.ok ? { value: m.value } : { error: m.error })
}

function bytes(b64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function modFetch(input: string | URL, init: { method?: string; headers?: HeadersInit; body?: string | null } = {}): Promise<Response> {
  if (init.body !== undefined && init.body !== null && typeof init.body !== "string") throw new TypeError("a mod's fetch sends a string body")
  const r = (await request((id) => ({
    type: "fetch",
    id,
    url: String(input),
    init: { method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body ?? null },
  }))) as ModFetchResult
  const empty = r.status === 204 || r.status === 304 || (init.method ?? "GET").toUpperCase() === "HEAD"
  return new Response(empty ? null : bytes(r.body), { status: r.status, statusText: r.statusText, headers: r.headers })
}

function keyed(key: string): string {
  const k = String(key)
  if (!k || k.length > STORAGE.key) throw new RangeError(`a storage key has 1 to ${STORAGE.key} characters`)
  return k
}

function stored(op: StorageOp, key: string | null, value: string | null): Promise<string | string[] | null> {
  const [id, reply] = wait(storing)
  post({ type: "storage", id, op, key, value })
  return reply
}

export const storage = {
  async get<T = unknown>(key: string): Promise<T | undefined> {
    const v = await stored("get", keyed(key), null)
    return typeof v === "string" ? (JSON.parse(v) as T) : undefined
  },
  async set(key: string, value: unknown): Promise<void> {
    const json = JSON.stringify(value)
    if (json === undefined) throw new TypeError("storage.set() keeps what JSON can hold")
    if (json.length > STORAGE.value) throw new RangeError(`a stored value is at most ${STORAGE.value.toLocaleString("en")} characters as JSON`)
    await stored("set", keyed(key), json)
  },
  async remove(key: string): Promise<void> {
    await stored("remove", keyed(key), null)
  },
  async keys(): Promise<string[]> {
    const v = await stored("keys", null, null)
    return Array.isArray(v) ? v : []
  },
}

export const Toast = {
  show({ title, message, style }: { title: string; message?: string; style?: ToastStyle }): void {
    post({ type: "toast", title: String(title).slice(0, 200), message: message === undefined ? null : String(message).slice(0, 500), style: style ?? null })
  },
}

export const openUrl = (url: string): void => post({ type: "link", url: String(url) })

export const copy = (text: string, note?: string): void => post({ type: "copy", text: String(text), note: note === undefined ? null : String(note) })
