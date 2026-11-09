import { t } from "~/i18n/i18n"
import type { Pending } from "~/live/map"
import { limitWords, refusal } from "~/live/refused"
import type { SendExtras, Upload, Where } from "~/model"

type Shelf = Pick<Storage, "getItem" | "setItem">

const SAVED = "kiwi:unsent"
const FRESH = 60 * 60_000

let byRoom = new Map<string, Pending[]>()
let lastKey = 0
let shelf: Shelf | null = null
const resending = new Set<string>()

function storage(): Shelf | null {
  try {
    return localStorage
  } catch {
    // No local storage (tests, a locked-down page): failed messages last until the window reloads.
    return null
  }
}

const isUpload = (v: unknown): v is Upload =>
  typeof v === "object" && v !== null && "name" in v && "mime" in v && "data" in v && typeof v.name === "string" && typeof v.mime === "string" && typeof v.data === "string"

const isWhere = (v: unknown): v is Where => {
  if (typeof v !== "object" || v === null || !("kind" in v)) return false
  if (v.kind === "room") return "room" in v && typeof v.room === "string"
  if (v.kind === "dm") return "with" in v && typeof v.with === "string"
  return v.kind === "task" && "task" in v && typeof v.task === "number"
}

const optional = (v: object, key: string, type: "number" | "string"): boolean => !(key in v) || typeof Reflect.get(v, key) === type

function isFailed(v: unknown): v is Pending {
  if (typeof v !== "object" || v === null || !("key" in v) || !("where" in v) || !("text" in v) || !("at" in v) || !("failed" in v)) return false
  if (typeof v.key !== "number" || typeof v.text !== "string" || typeof v.at !== "number" || typeof v.failed !== "string" || !isWhere(v.where)) return false
  if (!optional(v, "inThread", "number") || !optional(v, "replyTo", "number")) return false
  if ("images" in v && !(Array.isArray(v.images) && v.images.every(isUpload))) return false
  return !("block" in v) || (typeof v.block === "object" && v.block !== null && "th" in v.block && "id" in v.block && typeof v.block.th === "string" && typeof v.block.id === "string")
}

function read(on: Shelf | null): Map<string, Pending[]> {
  try {
    const got: unknown = JSON.parse(on?.getItem(SAVED) ?? "{}")
    if (typeof got !== "object" || got === null) return new Map()
    return new Map(
      Object.entries(got).flatMap(([room, v]: [string, unknown]): [string, Pending[]][] => {
        const list = Array.isArray(v) ? v.filter(isFailed) : []
        return list.length ? [[room, list]] : []
      })
    )
  } catch {
    // Storage can be off or hold junk: start with no failed messages.
    return new Map()
  }
}

const failedIn = (list: readonly Pending[]): Pending[] => list.filter((p) => p.failed !== undefined)

const saved = (strip: (p: Pending) => Pending): string =>
  JSON.stringify(
    Object.fromEntries(
      [...byRoom].flatMap(([room, list]) => {
        const failed = failedIn(list).map(strip)
        return failed.length ? [[room, failed]] : []
      })
    )
  )

const withoutImages = (p: Pending): Pending => (p.images?.length ? { ...p, images: [], lostImages: true } : p)

function keep(): void {
  if (!shelf) return
  try {
    shelf.setItem(
      SAVED,
      saved((p) => p)
    )
  } catch {
    // Storage is full, most likely of images: keep the words, which matter most.
    try {
      shelf.setItem(SAVED, saved(withoutImages))
    } catch {
      // Storage is off or full even for words: failed messages last until the window reloads.
    }
  }
}

export function restoreUnsent(on: Shelf | null): void {
  shelf = on
  byRoom = read(on)
  lastKey = Math.max(lastKey, ...[...byRoom.values()].flat().map((p) => p.key))
}

restoreUnsent(storage())

export const nextUnsentKey = (): number => ++lastKey

export const unsentIn = (room: string): Pending[] => byRoom.get(room) ?? []

export function changeUnsent(room: string, change: (list: Pending[]) => Pending[]): Pending[] {
  const before = failedIn(unsentIn(room))
  const next = change(unsentIn(room))
  if (next.length) byRoom.set(room, next)
  else byRoom.delete(room)
  const after = failedIn(next)
  if (before.length !== after.length || before.some((p, i) => p !== after[i])) keep()
  return next
}

export function capUnsent(list: Pending[], max: number): Pending[] {
  let spare = list.length - max
  return spare > 0 ? list.filter((p) => p.failed !== undefined || p.seq === undefined || spare-- <= 0) : list
}

export const unsentBlock = (list: readonly Pending[], key: number): string | null => list.find((p) => p.key === key)?.block?.id ?? null

export const resendOf = (p: Pending): SendExtras => ({
  ...(p.inThread !== undefined ? { inThread: p.inThread } : {}),
  ...(p.side ? { side: true as const } : {}),
  ...(p.replyTo !== undefined ? { replyTo: p.replyTo } : {}),
  ...(p.images?.length ? { images: p.images } : {}),
  ...(p.block ? { block: p.block } : {}),
})

export async function retryUnsent(list: readonly Pending[], key: number, drop: (key: number) => void, post: (where: Where, text: string, extras: SendExtras) => Promise<number>): Promise<number> {
  const p = list.find((x) => x.key === key)
  if (!p) throw new Error(t("live.channel.message.gone"))
  drop(key)
  return post(p.where, p.text, resendOf(p))
}

const dueAgain = (p: Pending, now: number): boolean => p.failed !== undefined && !p.lostImages && !limitWords(p.failed) && now - p.at < FRESH

export async function resendDue(room: string, now: number, retry: (key: number) => Promise<number>): Promise<void> {
  if (resending.has(room)) return
  resending.add(room)
  try {
    for (const { key } of unsentIn(room).filter((p) => dueAgain(p, now))) {
      if (!unsentIn(room).some((p) => p.key === key && p.failed !== undefined)) continue
      try {
        await retry(key)
      } catch (err) {
        // A refusal went back to the composer, so the next one may still pass; anything else means the connection is down again and the rest wait for the next reconnect.
        if (refusal(err) === null) return
      }
    }
  } finally {
    resending.delete(room)
  }
}
