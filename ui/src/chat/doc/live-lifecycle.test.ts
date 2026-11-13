import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from "bun:test"
import * as blocks from "@kiwi/core/doc/blocks.ts"
import type { PipeIn } from "@kiwi/core/doc/held-pipe.ts"
import type { ChannelLink } from "@kiwi/channel/channel-ops.ts"

import type { DocEvent } from "../../../../desktop/src/bridge.ts"
import * as appCanModule from "~/live/app-can"
import { changeBlock } from "~/chat/doc/change-block"
import { LiveDoc } from "~/chat/doc/live"
import { restoreOf } from "~/chat/doc/restore-version"

const WAIT = 15_000
const LINGER = 5_000

interface Opener {
  emit: (e: DocEvent) => void
  readonly opens: number
  open: (on: (e: DocEvent) => void) => PipeIn
}

function opener(how: { syncReady?: boolean; throws?: boolean } = {}): Opener {
  let on: ((e: DocEvent) => void) | null = null
  let opens = 0
  return {
    emit: (e) => on?.(e),
    get opens() {
      return opens
    },
    open: (listener) => {
      opens++
      if (how.throws) throw new Error("open failed")
      on = listener
      if (how.syncReady) listener({ _tag: "Ready" })
      return { update: () => {}, aware: () => {}, close: () => {} }
    },
  }
}

interface Caller {
  name: string
  mutation: "removeBlock" | "restoreThread"
  start: (o: Opener) => Promise<boolean>
}

const callers: Caller[] = [
  {
    name: "changeBlock",
    mutation: "removeBlock",
    start: (o) => changeBlock((_thread, _th, on) => o.open(on), new Map([["main", "th1"]]), { th: "th1", id: "b1" }, null),
  },
  {
    name: "restoreOf",
    mutation: "restoreThread",
    start: (o) => restoreOf({ docVersionState: async () => "AAAA", doc: (_thread: string, _at: string | null, on: (e: DocEvent) => void) => o.open(on) } as unknown as ChannelLink, "main", "th1", 3),
  },
]

let destroys = 0
let offs = 0
let mutations = 0
let mutationResult: boolean | "throw" = true

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

function track(p: Promise<boolean>): { readonly state: "pending" | boolean | "rejected" } {
  const t: { state: "pending" | boolean | "rejected" } = { state: "pending" }
  p.then(
    (v) => void (t.state = v),
    () => void (t.state = "rejected")
  )
  return t
}

const spies: { mockRestore: () => void }[] = []

beforeEach(() => {
  jest.useFakeTimers()
  destroys = 0
  offs = 0
  mutations = 0
  mutationResult = true
  const destroy = LiveDoc.prototype.destroy
  const whenReady = LiveDoc.prototype.whenReady
  spies.push(
    spyOn(LiveDoc.prototype, "destroy").mockImplementation(function (this: LiveDoc) {
      destroys++
      destroy.call(this)
    }),
    spyOn(LiveDoc.prototype, "whenReady").mockImplementation(function (this: LiveDoc, l: () => void) {
      const off = whenReady.call(this, l)
      return () => {
        offs++
        off()
      }
    }),
    spyOn(appCanModule, "appCan").mockResolvedValue(true)
  )
  for (const name of ["removeBlock", "restoreThread"] as const)
    spies.push(
      spyOn(blocks, name).mockImplementation(() => {
        mutations++
        if (mutationResult === "throw") throw new Error("change failed")
        return mutationResult
      })
    )
})

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore()
  jest.useRealTimers()
})

for (const caller of callers)
  describe(`${caller.name}: the LiveDoc lifecycle (#2422)`, () => {
    test("ready then a change: settles true at once, unsubscribes, and destroys exactly once at the 5 s linger", async () => {
      const o = opener()
      const t = track(caller.start(o))
      await flush()
      expect(t.state).toBe("pending")
      o.emit({ _tag: "Ready" })
      await flush()
      expect(t.state).toBe(true)
      expect([mutations, offs, destroys]).toEqual([1, 1, 0])
      jest.advanceTimersByTime(LINGER - 1)
      expect(destroys).toBe(0)
      jest.advanceTimersByTime(1)
      expect(destroys).toBe(1)
      jest.advanceTimersByTime(60_000)
      expect([mutations, destroys, o.opens]).toEqual([1, 1, 1])
    })

    test("ready during construction: changes without subscribing, then lingers 5 s", async () => {
      const o = opener({ syncReady: true })
      const t = track(caller.start(o))
      await flush()
      expect(t.state).toBe(true)
      expect([mutations, offs, destroys]).toEqual([1, 0, 0])
      jest.advanceTimersByTime(LINGER - 1)
      expect(destroys).toBe(0)
      jest.advanceTimersByTime(1)
      expect(destroys).toBe(1)
    })

    test("a change that changes nothing settles false and destroys at 0 ms", async () => {
      mutationResult = false
      const o = opener()
      const t = track(caller.start(o))
      await flush()
      o.emit({ _tag: "Ready" })
      await flush()
      expect(t.state).toBe(false)
      expect([mutations, offs, destroys]).toEqual([1, 1, 0])
      jest.advanceTimersByTime(0)
      expect(destroys).toBe(1)
      jest.advanceTimersByTime(60_000)
      expect(destroys).toBe(1)
    })

    test("Failed before ready settles false without changing anything, destroying at 0 ms", async () => {
      const o = opener()
      const t = track(caller.start(o))
      await flush()
      o.emit({ _tag: "Failed", error: { kind: "other", message: "gone" } })
      await flush()
      expect(t.state).toBe(false)
      expect([mutations, offs, destroys]).toEqual([0, 1, 0])
      jest.advanceTimersByTime(0)
      expect(destroys).toBe(1)
    })

    test("never ready: settles false exactly at the 15 s wait, then destroys at 0 ms", async () => {
      const o = opener()
      const t = track(caller.start(o))
      await flush()
      jest.advanceTimersByTime(WAIT - 1)
      await flush()
      expect(t.state).toBe("pending")
      jest.advanceTimersByTime(1)
      await flush()
      expect(t.state).toBe(false)
      expect([mutations, offs, destroys]).toEqual([0, 1, 0])
      jest.advanceTimersByTime(0)
      expect(destroys).toBe(1)
    })

    test("ready only after the wait ran out changes nothing and destroys only once", async () => {
      const o = opener()
      const t = track(caller.start(o))
      await flush()
      jest.advanceTimersByTime(WAIT)
      await flush()
      expect(t.state).toBe(false)
      o.emit({ _tag: "Ready" })
      jest.advanceTimersByTime(60_000)
      await flush()
      expect([mutations, offs, destroys]).toEqual([0, 1, 1])
    })

    test("repeated readiness changes once and settles once", async () => {
      const o = opener()
      const t = track(caller.start(o))
      await flush()
      o.emit({ _tag: "Ready" })
      o.emit({ _tag: "Ready" })
      await flush()
      expect(t.state).toBe(true)
      jest.advanceTimersByTime(60_000)
      expect([mutations, offs, destroys]).toEqual([1, 1, 1])
    })

    test("a change that throws on readiness: the throw reaches the event, and the wait still settles false at 15 s", async () => {
      mutationResult = "throw"
      const o = opener()
      const t = track(caller.start(o))
      await flush()
      expect(() => o.emit({ _tag: "Ready" })).toThrow("change failed")
      jest.advanceTimersByTime(WAIT - 1)
      await flush()
      expect(t.state).toBe("pending")
      expect([mutations, offs, destroys]).toEqual([1, 0, 0])
      jest.advanceTimersByTime(1)
      await flush()
      expect(t.state).toBe(false)
      jest.advanceTimersByTime(0)
      jest.advanceTimersByTime(60_000)
      expect([mutations, offs, destroys]).toEqual([1, 1, 1])
    })

    test("a change that throws during construction rejects, and nothing is destroyed", async () => {
      mutationResult = "throw"
      const t = track(caller.start(opener({ syncReady: true })))
      await flush()
      jest.advanceTimersByTime(60_000)
      await flush()
      expect(t.state).toBe("rejected")
      expect([mutations, offs, destroys]).toEqual([1, 0, 0])
    })

    test("an open that throws rejects without changing or destroying anything", async () => {
      const o = opener({ throws: true })
      const t = track(caller.start(o))
      await flush()
      jest.advanceTimersByTime(60_000)
      await flush()
      expect(t.state).toBe("rejected")
      expect([o.opens, mutations, offs, destroys]).toEqual([1, 0, 0, 0])
    })
  })
