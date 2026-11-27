import { useState } from "react"

import type { ChannelState } from "@kiwi/core/state.ts"
import { same } from "@kiwi/core/state/same.ts"
import { shownSame } from "~/words"

export const PER_MESSAGE: ReadonlySet<string> = new Set(["head", "members", "trust", "threadOf", "threadPeople", "roomOf", "placeOf", "places", "askHeads", "rejected", "chatBy"])

export const SEAT_COUNTERS: ReadonlySet<string> = new Set(["lastSeen", "messages"])

interface BoardKey {
  whole: readonly [string, unknown][]
  seen: unknown
}

function boardKeyOf(state: ChannelState): BoardKey {
  return {
    whole: Object.entries(state).filter(([k]) => !PER_MESSAGE.has(k)),
    seen: [
      [...state.members.values()].map((m) => Object.entries(m).filter(([k]) => !SEAT_COUNTERS.has(k))),
      state.openAsks.map((m) => state.placeOf.get(m.seq)),
      [...state.tasks.values()].map((t) => (t.ask === undefined ? undefined : [state.askHeads.has(t.ask), state.askHeads.get(t.ask)])),
    ],
  }
}

const sameBoard = (a: BoardKey, b: BoardKey): boolean => a.whole.length === b.whole.length && a.whole.every(([k, v], i) => b.whole[i]![0] === k && Object.is(v, b.whole[i]![1])) && same(a.seen, b.seen)

export function keptBoard(was: { state: ChannelState; key: BoardKey } | null, state: ChannelState): { state: ChannelState; key: BoardKey } {
  if (was?.state === state) return was
  const key = boardKeyOf(state)
  return was && sameBoard(key, was.key) ? was : { state, key }
}

export function useBoard(state: ChannelState): ChannelState {
  const [kept, setKept] = useState(() => keptBoard(null, state))
  const next = keptBoard(kept, state)
  if (next !== kept) setKept(next)
  return next.state
}

export function useStable<T>(value: T): T {
  const [kept, setKept] = useState(() => ({ value }))
  if (shownSame(kept.value, value)) return kept.value
  setKept({ value })
  return value
}
