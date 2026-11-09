import { useEffect, useSyncExternalStore } from "react"

import type { Usage } from "~/model"

const FRESH_MS = 5 * 60_000

type Get = () => Promise<Usage | null>

export type SeenUsage = Usage & { checkedAt: number }

let usage: SeenUsage | null = null
let fetchedAt = 0
let loading = false
const usageSubs = new Set<() => void>()

export function loadUsage(get: Get, force = false): void {
  if (loading || (!force && Date.now() - fetchedAt < FRESH_MS)) return
  loading = true
  fetchedAt = Date.now()
  get()
    .then((u) => {
      usage = u && { ...u, checkedAt: Date.now() }
      for (const f of usageSubs) f()
    })
    .catch(() => {
      // Account and the rail show the last numbers until the next try.
    })
    .finally(() => {
      loading = false
    })
}

const onUsage = (f: () => void) => {
  usageSubs.add(f)
  return () => usageSubs.delete(f)
}

export function useUsage(get: Get): SeenUsage | null {
  const now = useSyncExternalStore(onUsage, () => usage)
  useEffect(() => {
    const again = () => loadUsage(get)
    again()
    const tick = window.setInterval(again, FRESH_MS)
    window.addEventListener("focus", again)
    return () => {
      window.clearInterval(tick)
      window.removeEventListener("focus", again)
    }
  }, [get])
  return now
}

export type LimitHit = { code: string | null }

let hit: LimitHit | null = null
let hitAt = 0
const hitSubs = new Set<() => void>()
const QUIET_MS = 10 * 60_000

export function showLimit(code: string | null): void {
  if (hit || Date.now() - hitAt < QUIET_MS) return
  hit = { code }
  hitAt = Date.now()
  for (const f of hitSubs) f()
}

export function closeLimit(): void {
  hit = null
  for (const f of hitSubs) f()
}

export const useLimitHit = (): LimitHit | null =>
  useSyncExternalStore(
    (f) => {
      hitSubs.add(f)
      return () => hitSubs.delete(f)
    },
    () => hit
  )
