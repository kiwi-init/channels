import { ignored, type Message as Wire } from "@kiwi/core/protocol.ts"
import { rootOf } from "@kiwi/core/room-rules.ts"
import type { ChannelState } from "@kiwi/core/state.ts"
import { mentions } from "~/live/mention"
import type { ThreadItem } from "~/model"
import { seenAt } from "@kiwi/app/threads.ts"

type Seen = Readonly<Record<string, number>>

export const threadSeenKey = (root: number): string => `thread:${root}`

export const followKey = (root: number): string => `follow:${root}`

export function followMark(was: number | undefined, head: number, on: boolean): number {
  const next = Math.max((was ?? 0) + 1, head * 2)
  return next % 2 === (on ? 1 : 0) ? next : next + 1
}

export function followsOf(seen: Seen, root: number): boolean | null {
  const mark = seen[followKey(root)]
  return mark === undefined ? null : mark % 2 === 1
}

export function followsIn(seen: Seen): Record<number, boolean> {
  const out: Record<number, boolean> = {}
  for (const [key, mark] of Object.entries(seen)) {
    const root = key.startsWith("follow:") ? Number(key.slice(7)) : Number.NaN
    if (Number.isSafeInteger(root)) out[root] = mark % 2 === 1
  }
  return out
}

export function threadsOf(state: Pick<ChannelState, "threadOf" | "trust" | "members" | "deleted" | "specs">, messages: readonly Wire[], me: string, seen: Seen, from: number): ThreadItem[] {
  const person = rootOf(me, state.members)
  const mine = (m: Wire) => rootOf(m.from, state.members) === person
  const forMe = (m: Wire) => !mine(m) && (!!m.to?.includes(me) || mentions(m.body, me))
  const roots = new Map<number, Wire>()
  const threads = new Map<number, ThreadItem & { yours: boolean }>()
  for (const m of messages) {
    if (m.kind === "event" || ignored(state.trust.get(m.seq))) continue
    const root = state.threadOf.get(m.seq)
    if (root === undefined || root === m.seq) {
      roots.set(m.seq, m)
      continue
    }
    const head = roots.get(root)
    if (!head || state.specs.has(root)) continue
    const t = threads.get(root) ?? {
      root,
      following: false,
      yours: mine(head) || forMe(head),
      replies: 0,
      unread: 0,
      mentions: 0,
      last: 0,
      lastSeq: 0,
      people: [],
    }
    t.replies++
    t.last = Math.max(t.last, m.ts)
    t.lastSeq = Math.max(t.lastSeq, m.seq)
    if (!t.people.includes(m.from)) t.people.push(m.from)
    if (mine(m) || forMe(m)) t.yours = true
    if (!mine(m) && !state.deleted.has(m.seq) && m.seq > seenAt(seen, threadSeenKey(root), from)) {
      t.unread++
      if (forMe(m)) t.mentions++
    }
    threads.set(root, t)
  }
  return [...threads.values()].map(({ yours, ...t }) => ({ ...t, following: followsOf(seen, t.root) ?? yours })).sort((a, b) => b.lastSeq - a.lastSeq)
}
