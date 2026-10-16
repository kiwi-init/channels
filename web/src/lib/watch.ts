import type { ChannelOps, FollowEvent } from "../../../desktop/src/bridge.ts"

type WatchEvent = { _tag: "Open" } | { _tag: "Head"; seq: number } | { _tag: "Request" }

type Listener = (e: WatchEvent) => void

interface Entry {
  listeners: Set<Listener>
  lent: number
  stop: (() => void) | null
}

export interface Watches {
  watch(code: string, on: Listener): () => void
  lend(code: string): { emit: (e: WatchEvent) => void; release: () => void }
}

function asWatch(ev: FollowEvent): WatchEvent | null {
  switch (ev._tag) {
    case "Open":
    case "Request":
      return { _tag: ev._tag }
    case "Head":
      return { _tag: "Head", seq: ev.seq }
    default:
      return null
  }
}

export function makeWatches(via: Pick<ChannelOps, "follow">): Watches {
  const entries = new Map<string, Entry>()
  const seen = new Map<string, number>()
  const entry = (code: string): Entry => {
    let e = entries.get(code)
    if (!e) entries.set(code, (e = { listeners: new Set(), lent: 0, stop: null }))
    return e
  }
  const tell = (code: string, e: Entry, ev: WatchEvent) => {
    if (ev._tag === "Head") seen.set(code, Math.max(seen.get(code) ?? 0, ev.seq))
    for (const l of [...e.listeners]) l(ev)
  }
  const sync = (code: string, e: Entry) => {
    const want = e.listeners.size > 0 && e.lent === 0
    if (want && !e.stop) {
      e.stop = via.follow(
        code,
        seen.get(code) ?? 0,
        (ev) => {
          const w = asWatch(ev)
          if (w && entries.get(code) === e && e.stop) tell(code, e, w)
        },
        { watch: true }
      )
    } else if (!want && e.stop) {
      const stop = e.stop
      e.stop = null
      stop()
    }
    if (!e.listeners.size && !e.lent && entries.get(code) === e) entries.delete(code)
  }
  return {
    watch: (code, on) => {
      const e = entry(code)
      e.listeners.add(on)
      sync(code, e)
      return () => {
        e.listeners.delete(on)
        sync(code, e)
      }
    },
    lend: (code) => {
      const e = entry(code)
      e.lent++
      sync(code, e)
      let held = true
      return {
        emit: (ev) => {
          if (held) tell(code, e, ev)
        },
        release: () => {
          if (!held) return
          held = false
          e.lent--
          sync(code, e)
        },
      }
    },
  }
}
