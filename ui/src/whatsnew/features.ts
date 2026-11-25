import { useSyncExternalStore } from "react"

type Store = Pick<Storage, "getItem" | "setItem">
type Kept = { on: string[]; seen: string[] }

const KEY = "mc.features"
const listeners = new Set<() => void>()
let kept: Kept | null = null
let asked = 0

const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && /^[a-z0-9-]{1,40}$/.test(x)))].slice(0, 200) : [])

export function readFeatures(store: Store): Kept {
  try {
    const raw = JSON.parse(store.getItem(KEY) ?? "{}") as Partial<Kept>
    return { on: ids(raw.on), seen: ids(raw.seen) }
  } catch {
    // A broken entry reads as nothing on and nothing seen: the window shows again, every switch off.
    return { on: [], seen: [] }
  }
}

function now(): Kept {
  if (kept) return kept
  try {
    kept = readFeatures(localStorage)
  } catch {
    kept = { on: [], seen: [] }
  }
  return kept
}

function put(next: Kept): void {
  kept = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Without storage the choice holds until the app closes.
  }
  for (const l of [...listeners]) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

const featureOn = (id: string): boolean => now().on.includes(id)

export function setFeature(id: string, on: boolean): void {
  const k = now()
  put({ ...k, on: on ? [...new Set([...k.on, id])] : k.on.filter((x) => x !== id) })
}

export function markSeen(list: readonly string[]): void {
  const k = now()
  if (list.every((id) => k.seen.includes(id))) return
  put({ ...k, seen: [...new Set([...k.seen, ...list])] })
}

export const useFeature = (id: string): boolean => useSyncExternalStore(subscribe, () => featureOn(id))

export const useOn = (): readonly string[] => useSyncExternalStore(subscribe, () => now().on)

export const useSeen = (): readonly string[] => useSyncExternalStore(subscribe, () => now().seen)

export function askWhatsNew(): void {
  asked += 1
  for (const l of [...listeners]) l()
}

export const useAsked = (): number => useSyncExternalStore(subscribe, () => asked)
