import { olderRules, type Message } from "@kiwi/core/protocol.ts"
import type { FoldBase } from "@kiwi/core/state.ts"
import type { OpenedCache } from "../history"
import { planReload } from "../history-plan"
import { baseFrom, newestRules, startsWhole, usableBase } from "./base-plan"
import { keptBaseUpTo, type Kept } from "./kept"
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
  kept: () => Promise<Kept | null>
  plan: (cache: OpenedCache, head: number) => Promise<Planned | null>
  snapshot: () => Promise<FoldBase | null>
  early: (cached: Planned | null, kept: Kept) => void
  paint: (cached: Planned | null, base: FoldBase | null, head: number, replace: boolean) => void
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
  return { ...steps, rotate: memo(steps.rotate), cache: memo(steps.cache), kept: memo(steps.kept), snapshot: memo(steps.snapshot) }
}

function provisional(cache: OpenedCache | null, limit: number): Planned | null {
  if (!cache?.opened.length) return null
  const seqs = cache.opened.map((m) => m.seq)
  const plan = planReload(seqs, Math.max(...seqs), limit)
  const keep = new Set(plan.keep)
  const kept = cache.opened.filter((m) => keep.has(m.seq)).sort((a, b) => a.seq - b.seq)
  if (!kept.length) return null
  return { messages: kept.filter((m): m is Message => !("unread" in m)), unread: kept.filter((m) => "unread" in m).map((m) => m.seq), firstSeq: kept[0]!.seq, since: plan.since }
}

export function warmUp(steps: OpenSteps, was: Warm | undefined, limit: number): void {
  if (was?.messages.length) return
  void Promise.all([steps.cache(), steps.kept()]).then(([cache, kept]) => {
    const first = cache?.opened.length ? Math.min(...cache.opened.map((m) => m.seq)) : undefined
    const base = was?.base ?? kept?.base ?? null
    const covered = first === 1 || (base !== null && first !== undefined && base.n >= first - 1)
    if (!covered) void steps.snapshot()
    if (kept) steps.early(provisional(cache, limit), kept)
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
  const kept = was?.base ? null : await steps.kept()
  const keptBase = usableBase(keptBaseUpTo(kept, head), from)
  const warm = usableBase(was?.base ?? null, from) ?? keptBase
  const snap = from > 0 && (!warm || olderRules(warm)) ? await steps.snapshot() : null
  const offered = [usableBase(snap, from), keptBase]
  const base = from === 0 ? (offered.find((b) => b !== null && !olderRules(b)) ?? null) : newestRules(offered)
  steps.paint(cached, base, head, from === 0 && !!warm && olderRules(warm))
  if (await rotated) await steps.roster()
  return { head, since, whole: startsWhole(head, limit, since, firstSeq, base ?? warm) }
}

export function handOver<T extends { seq: number }>(shown: readonly T[], early: ReadonlySet<number>, planned: readonly T[]): T[] {
  const kept = shown.filter((m) => !early.has(m.seq))
  const seen = new Set(kept.map((m) => m.seq))
  return [...kept, ...planned.filter((m) => !seen.has(m.seq))].sort((a, b) => a.seq - b.seq)
}
