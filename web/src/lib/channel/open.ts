import type { Message } from "@kiwi/core/protocol.ts"
import type { FoldBase } from "@kiwi/core/state.ts"
import type { OpenedCache } from "../history"
import { baseFrom, startsWhole, usableBase } from "./base-plan"
import { heldWindow, type Warm } from "./warm"

export interface Planned {
  messages: Message[]
  unread: number[]
  firstSeq: number | undefined
  since: number
}

export interface OpenSteps {
  head: () => Promise<number>
  roster: () => Promise<void>
  requests: () => Promise<void>
  rotate: () => Promise<boolean>
  cache: () => Promise<OpenedCache | null>
  plan: (cache: OpenedCache, head: number) => Promise<Planned | null>
  snapshot: () => Promise<FoldBase | null>
  paint: (cached: Planned | null, base: FoldBase | null) => void
}

export interface Opened {
  head: number
  since: number
  whole: boolean
}

export function onceEach(steps: OpenSteps): OpenSteps {
  const memo = <T>(run: () => Promise<T>): (() => Promise<T>) => {
    let kept: Promise<T> | null = null
    return () => (kept ??= run())
  }
  return { ...steps, rotate: memo(steps.rotate), cache: memo(steps.cache), snapshot: memo(steps.snapshot) }
}

export function warmUp(steps: OpenSteps, was: Warm | undefined): void {
  if (was?.messages.length) return
  void steps.cache().then((c) => {
    if (!was?.base && !c?.opened.some((m) => m.seq === 1)) void steps.snapshot()
  })
}

export async function openChannel(steps: OpenSteps, was: Warm | undefined, limit: number): Promise<Opened> {
  const rotated = steps.rotate()
  const [, , head] = await Promise.all([steps.roster(), steps.requests(), steps.head()])
  const held = heldWindow(was, head, limit)
  const opened = held ? null : await steps.cache()
  const cached = opened ? await steps.plan(opened, head) : null
  const since = held ? held.since : cached ? cached.since : Math.max(0, head - limit)
  const firstSeq = held ? held.firstSeq : cached?.firstSeq
  const from = baseFrom(since, firstSeq)
  const warm = usableBase(was?.base ?? null, from)
  const snap = from > 0 && !warm ? await steps.snapshot() : null
  const base = usableBase(snap, from)
  steps.paint(cached, base)
  if (await rotated) await steps.roster()
  return { head, since, whole: startsWhole(head, limit, since, firstSeq, base ?? warm) }
}
