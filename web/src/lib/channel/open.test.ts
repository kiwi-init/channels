import { describe, expect, test } from "bun:test"
import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts"
import type { FoldBase } from "@kiwi/core/state.ts"
import type { OpenedCache } from "../history"
import { onceEach, openChannel, warmUp, type OpenSteps, type Planned } from "./open"

const msg = (seq: number): Message => ({ v: PROTOCOL_VERSION, id: `id-${seq}`, from: "atlas", kind: "msg", body: `m${seq}`, ts: 1_700_000_000_000 + seq, seq, sigOk: true })
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const base = (n: number): FoldBase => ({ n }) as FoldBase

function relay(rotateTrips = 1, rotated = false) {
  const log: string[] = []
  let waiting: (() => void)[] = []
  let trips = 0
  const trip = <T>(name: string, value: T, count = 1): Promise<T> => {
    log.push(`${name}@${trips}`)
    return new Promise((ok) => {
      let left = count
      const step = () => (--left === 0 ? ok(value) : waiting.push(step))
      waiting.push(step)
    })
  }
  const settle = () => new Promise((r) => setTimeout(r, 0))
  const roundTrip = async () => {
    const now = waiting
    waiting = []
    trips++
    for (const w of now) w()
    await settle()
  }
  const painted: { at: number; seqs: number[]; base: number | null }[] = []
  const make = (head: number, cache: number[], snap: number | null): OpenSteps =>
    onceEach({
      head: () => trip("head", head),
      roster: () => trip("roster", undefined),
      requests: () => trip("requests", undefined),
      rotate: () => trip("rotate", rotated, rotateTrips),
      cache: async () => (cache.length ? ({ stored: cache.length, opened: cache.map(msg) } satisfies OpenedCache) : null),
      plan: async (c, h): Promise<Planned> => ({
        messages: c.opened.filter((m): m is Message => !("unread" in m) && m.seq <= h),
        unread: [],
        firstSeq: c.opened[0]?.seq,
        since: Math.min(h, c.opened.at(-1)!.seq),
      }),
      snapshot: () => trip("snapshot", snap === null ? null : base(snap)),
      paint: (cached, b) => painted.push({ at: trips, seqs: cached?.messages.map((m) => m.seq) ?? [], base: b?.n ?? null }),
    })
  return { log, roundTrip, painted, make, trips: () => trips, settle }
}

describe("opening a channel", () => {
  test("paints the cached history after one round trip: roster, requests and head go out together", async () => {
    const r = relay()
    const steps = r.make(400, range(1, 400), null)
    warmUp(steps, undefined)
    let done = false
    void openChannel(steps, undefined, 2000).then(() => (done = true))
    await r.settle()
    expect(r.log.sort()).toEqual(["head@0", "requests@0", "roster@0", "rotate@0"])
    await r.roundTrip()
    expect(r.painted).toEqual([{ at: 1, seqs: range(1, 400), base: null }])
    expect(done).toBe(true)
  })

  test("an owner's key check doesn't hold the paint, but the channel isn't open until it's done", async () => {
    const r = relay(3, true)
    let opened = false
    void openChannel(r.make(400, range(1, 400), null), undefined, 2000).then(() => (opened = true))
    await r.settle()
    await r.roundTrip()
    expect(r.painted.map((p) => p.at)).toEqual([1])
    expect(opened).toBe(false)
    await r.roundTrip()
    await r.roundTrip()
    expect(opened).toBe(false)
    expect(r.log.filter((l) => l.startsWith("roster"))).toEqual(["roster@0", "roster@3"])
    await r.roundTrip()
    expect(opened).toBe(true)
  })

  test("a cache that doesn't reach the first message asks for the snapshot before head is back", async () => {
    const r = relay()
    const steps = r.make(5000, range(3001, 5000), 3000)
    warmUp(steps, undefined)
    let opened: { whole: boolean } | null = null
    void openChannel(steps, undefined, 2000).then((o) => (opened = o))
    await r.settle()
    expect(r.log).toContain("snapshot@0")
    await r.roundTrip()
    expect(r.painted).toEqual([{ at: 1, seqs: range(3001, 5000), base: 3000 }])
    expect(opened).toEqual({ head: 5000, since: 5000, whole: true })
  })

  test("a cache from the first message asks for no snapshot", async () => {
    const r = relay()
    const steps = r.make(400, range(1, 400), null)
    warmUp(steps, undefined)
    const opening = openChannel(steps, undefined, 2000)
    await r.settle()
    await r.roundTrip()
    await opening
    expect(r.log.filter((l) => l.startsWith("snapshot"))).toEqual([])
  })

  test("no cache on a long channel: the snapshot goes out with head, once", async () => {
    const r = relay()
    const steps = r.make(5000, [], 3000)
    warmUp(steps, undefined)
    void openChannel(steps, undefined, 2000)
    await r.settle()
    await r.roundTrip()
    expect(r.log.filter((l) => l.startsWith("snapshot"))).toEqual(["snapshot@0"])
    expect(r.painted).toEqual([{ at: 1, seqs: [], base: 3000 }])
  })
})
