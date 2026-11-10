import { useSyncExternalStore } from "react"

import { MAX_BODY_LENGTH } from "@kiwi/core/protocol.ts"
import { t } from "~/i18n/i18n"
import type { Upload, Where } from "~/model"

export const composerKey = (code: string, where: Where, inThread?: number): string => `${code}:${JSON.stringify(where)}:${inThread ?? ""}`

type Shelf = Pick<Storage, "getItem" | "setItem" | "removeItem">

const SAVED = "kiwi:drafts"
const WRITE_MS = 500
const KEEP_DRAFTS = 50
const KEEP_CHARS = 1_000_000
const KEEP_FILES = 20

function shelf(pick: () => Storage): Shelf | null {
  try {
    return pick()
  } catch {
    // No storage (tests, a locked-down page): drafts last until the window reloads.
    return null
  }
}

function saved(on: Shelf | null): [string, string][] {
  try {
    const got: unknown = JSON.parse(on?.getItem(SAVED) ?? "{}")
    if (typeof got !== "object" || got === null) return []
    return Object.entries(got).filter((e): e is [string, string] => typeof e[1] === "string" && !!e[1].trim())
  } catch {
    // Junk in storage: start with no saved drafts.
    return []
  }
}

function newestThatFit(all: Iterable<[string, string]>): [string, string][] {
  const kept: [string, string][] = []
  let room = KEEP_CHARS
  for (const [key, text] of [...all].reverse()) {
    if (kept.length === KEEP_DRAFTS) break
    if (!text.trim() || text.length > room) continue
    room -= text.length
    kept.unshift([key, text])
  }
  return kept
}

class Kept extends Map<string, string> {
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly on: Shelf | null,
    private readonly waitMs: number,
    before: Shelf | null
  ) {
    super(saved(on))
    const carried = saved(before).filter(([key]) => !super.has(key))
    for (const [key, text] of carried) super.set(key, text)
    if (carried.length) this.write()
    try {
      before?.removeItem(SAVED)
    } catch {
      // The old session copy stays: it is read again, and never beats a newer draft.
    }
  }

  override set(key: string, text: string): this {
    super.delete(key)
    super.set(key, text)
    this.soon()
    return this
  }

  override delete(key: string): boolean {
    const had = super.delete(key)
    if (had) this.soon()
    return had
  }

  flush = (): void => {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.write()
  }

  private soon(): void {
    if (this.on) this.timer ??= setTimeout(() => this.write(), this.waitMs)
  }

  private write(): void {
    this.timer = null
    if (!this.on) return
    const kept = newestThatFit(this)
    try {
      if (kept.length) this.on.setItem(SAVED, JSON.stringify(Object.fromEntries(kept)))
      else this.on.removeItem(SAVED)
    } catch {
      // Storage full or off: the draft still lives in memory until the window reloads.
    }
  }
}

export type KeptDrafts = Map<string, string> & { flush: () => void }

export const keptDrafts = (on: Shelf | null, waitMs = WRITE_MS, before: Shelf | null = null): KeptDrafts => new Kept(on, waitMs, before)

export const drafts = keptDrafts(
  shelf(() => localStorage),
  WRITE_MS,
  shelf(() => sessionStorage)
)

if (typeof addEventListener === "function") {
  addEventListener("pagehide", drafts.flush)
  addEventListener("visibilitychange", () => {
    if (document.hidden) drafts.flush()
  })
}

type KeptFiles = { files: Upload[]; at: number }

export type FileShelf = {
  all(): Promise<[string, unknown][]>
  put(key: string, kept: KeptFiles): Promise<void>
  drop(key: string): Promise<void>
}

const isUpload = (v: unknown): v is Upload =>
  typeof v === "object" && v !== null && "name" in v && "mime" in v && "data" in v && typeof v.name === "string" && typeof v.mime === "string" && typeof v.data === "string"

const isKeptFiles = (v: unknown): v is KeptFiles =>
  typeof v === "object" && v !== null && "files" in v && "at" in v && typeof v.at === "number" && Array.isArray(v.files) && v.files.length > 0 && v.files.every(isUpload)

const DB = "kiwi-drafts"
const FILES = "files"

function fileShelf(): FileShelf | null {
  if (typeof indexedDB === "undefined") return null
  let open: Promise<IDBDatabase> | null = null
  const db = (): Promise<IDBDatabase> =>
    (open ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => void req.result.createObjectStore(FILES)
      req.onsuccess = () => {
        req.result.onclose = () => void (open = null)
        resolve(req.result)
      }
      req.onerror = () => {
        open = null
        reject(req.error)
      }
    }))
  const run = async <T>(mode: IDBTransactionMode, ask: (store: IDBObjectStore) => () => T): Promise<T> => {
    const tx = (await db()).transaction(FILES, mode)
    const result = ask(tx.objectStore(FILES))
    return new Promise<T>((resolve, reject) => {
      tx.oncomplete = () => resolve(result())
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }
  return {
    all: () =>
      run("readonly", (store) => {
        const keys = store.getAllKeys()
        const values = store.getAll()
        return () => keys.result.map((key, i): [string, unknown] => [String(key), values.result[i]])
      }),
    put: (key, kept) => run("readwrite", (store) => (store.put(kept, key), () => undefined)),
    drop: (key) => run("readwrite", (store) => (store.delete(key), () => undefined)),
  }
}

class Attached extends Map<string, Upload[]> {
  readonly loaded: Promise<void>
  private readonly touched = new Set<string>()
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly on: FileShelf | null,
    onLoad: () => void
  ) {
    super()
    this.loaded = on ? this.load(on).then(onLoad) : Promise.resolve()
  }

  override set(key: string, files: Upload[]): this {
    super.delete(key)
    super.set(key, files)
    this.touched.add(key)
    this.write((on) => on.put(key, { files, at: Date.now() }))
    const oldest = this.size > KEEP_FILES ? this.keys().next().value : undefined
    if (oldest !== undefined) this.delete(oldest)
    return this
  }

  override delete(key: string): boolean {
    this.touched.add(key)
    this.write((on) => on.drop(key))
    return super.delete(key)
  }

  settled(): Promise<void> {
    return this.loaded.then(() => this.queue)
  }

  private write(act: (on: FileShelf) => Promise<void>): void {
    const on = this.on
    if (!on) return
    this.queue = this.queue.then(() =>
      act(on).catch(() => {
        // The disk refused it: the images still live in memory until the window reloads.
      })
    )
  }

  private async load(on: FileShelf): Promise<void> {
    const rows = await on.all().catch((): [string, unknown][] => {
      // No readable store: start with nothing attached.
      return []
    })
    const good = rows.flatMap(([key, kept]): [string, KeptFiles][] => (isKeptFiles(kept) ? [[key, kept]] : [])).sort((a, b) => a[1].at - b[1].at)
    const fresh = good.slice(-KEEP_FILES)
    const stale = new Set(rows.map(([key]) => key))
    for (const [key, kept] of fresh) {
      stale.delete(key)
      if (!this.touched.has(key)) super.set(key, kept.files)
    }
    for (const key of stale) this.write((s) => s.drop(key))
  }
}

export type KeptAttached = Map<string, Upload[]> & { settled: () => Promise<void> }

export const keptAttached = (on: FileShelf | null, onLoad: () => void = () => {}): KeptAttached => new Attached(on, onLoad)

let restored = 0

export const attached = keptAttached(fileShelf(), () => {
  restored++
  for (const l of listeners) l()
})

const backs = new Map<string, number>()
const listeners = new Set<() => void>()

export type Placed = "composer" | "stash"

export function giveBack(key: string, text: string, images: readonly Upload[], stash: (key: string, text: string) => void): Placed {
  const busy = !!drafts.get(key)?.trim() || !!attached.get(key)?.length
  if (busy) stash(key, text)
  else {
    drafts.set(key, text)
    if (images.length) attached.set(key, [...images])
  }
  backs.set(key, (backs.get(key) ?? 0) + 1)
  for (const l of listeners) l()
  return busy ? "stash" : "composer"
}

const listen = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function useGivenBack(key: string): number {
  return useSyncExternalStore(listen, () => backs.get(key) ?? 0)
}

export function useRestored(): number {
  return useSyncExternalStore(listen, () => restored)
}

export function tooLong(text: string): string | null {
  const over = text.length - MAX_BODY_LENGTH
  return over > 0 ? t("chat.drafts.too.long", { length: text.length, over, limit: MAX_BODY_LENGTH }) : null
}

export function backWords(why: string, placed: Placed, images: number): string {
  const lost = placed === "stash" && images ? (images === 1 ? t("chat.drafts.lost.image") : t("chat.drafts.lost.images", { count: images })) : ""
  return placed === "composer" ? t("chat.drafts.back.composer", { why }) : t("chat.drafts.back.stash", { why, lost })
}
