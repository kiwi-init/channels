import { useSyncExternalStore } from "react"

import { store } from "~/live/value"

export type Stashed = { text: string; at: number }
type Stashes = Readonly<Record<string, readonly Stashed[]>>

const KEY = "kiwi:stash"
const KEEP = 20
const SHOT = new URLSearchParams(location.search).get("shot")
export const STASH_SHOT = SHOT === "stash" || SHOT === "stash-open" ? SHOT : null

const MIN = 60_000
const DEMO: readonly Stashed[] = [
  { text: "@atlas is markdown lazy on the phone too, or only on desktop? asking before I sign off on T10", at: Date.now() - 20_000 },
  { text: "can we skip the mac signing until after the release? linux first", at: Date.now() - 12 * MIN },
  { text: "note: ask maya for the crash log from #112 before Friday", at: Date.now() - 26 * 60 * MIN },
]

const isStashed = (v: unknown): v is Stashed => typeof v === "object" && v !== null && "text" in v && "at" in v && typeof v.text === "string" && typeof v.at === "number"

function read(): Stashes {
  try {
    const got: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    if (typeof got !== "object" || got === null) return {}
    return Object.fromEntries(
      Object.entries(got).flatMap(([k, v]: [string, unknown]) => {
        const list = Array.isArray(v) ? v.filter(isStashed).slice(0, KEEP) : []
        return list.length ? [[k, list]] : []
      })
    )
  } catch {
    // Storage can be off or hold junk: start with no stashes.
    return {}
  }
}

function keep(all: Stashes): void {
  if (STASH_SHOT) return
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // Storage can be off or full: the stash lasts until the window reloads.
  }
}

const stashes = store<Stashes>(STASH_SHOT ? {} : read())
const NONE: readonly Stashed[] = []

function put(key: string, list: readonly Stashed[]): void {
  const next = { ...stashes.get() }
  if (list.length) next[key] = list.slice(0, KEEP)
  else delete next[key]
  stashes.set(next)
  keep(next)
}

export function useStash(key: string) {
  const all = useSyncExternalStore(stashes.subscribe, stashes.get)
  const list = all[key] ?? (STASH_SHOT && key.includes(`"general"`) ? DEMO : NONE)
  return {
    list,
    add: (text: string) => put(key, [{ text, at: Date.now() }, ...list]),
    take: (i: number, swap?: string): Stashed | undefined => {
      const got = list[i]
      if (!got) return undefined
      const rest = list.filter((_, j) => j !== i)
      put(key, swap ? [{ text: swap, at: Date.now() }, ...rest] : rest)
      return got
    },
    drop: (i: number) =>
      put(
        key,
        list.filter((_, j) => j !== i)
      ),
  }
}
