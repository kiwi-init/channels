import { describe, expect, test } from "bun:test"
import { FOLD_RULES, PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts"
import { fold, type FoldBase } from "@kiwi/core/state.ts"
import type { OpenedCache } from "../history"
import type { Kept } from "./kept"
import { planReload } from "../history-plan"
import { handOver, onceEach, openChannel, warmUp, type OpenSteps, type Planned } from "./open"

const msg = (seq: number): Message => ({ v: PROTOCOL_VERSION, id: `id-${seq}`, from: "atlas", kind: "msg", body: `m${seq}`, ts: 1_700_000_000_000 + seq, seq, sigOk: true })
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const empty = (): FoldBase => {
  const kept: { base?: FoldBase } = {}
  fold([], [], 0, null, null, null, (b) => void (kept.base = b))
  if (!kept.base) throw new Error("the fold kept no base")
  return kept.base
}
const base = (n: number): FoldBase => ({ ...empty(), n, rules: FOLD_RULES })
const kept = (n: number | null): Kept => ({ roster: [], base: n === null ? null : base(n), guardFloor: null, roomsFloor: null })

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
  const early: { at: number; seqs: number[]; base: number | null }[] = []
  const make = (head: number, cache: number[], snap: number | null, held: Kept | null = null): OpenSteps =>
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
      kept: async () => held,
      early: (cached, k) => early.push({ at: trips, seqs: cached?.messages.map((m) => m.seq) ?? [], base: k.base?.n ?? null }),
      paint: (cached, b) => painted.push({ at: trips, seqs: cached?.messages.map((m) => m.seq) ?? [], base: b?.n ?? null }),
    })
  return { log, roundTrip, painted, early, make, trips: () => trips, settle }
}

describe("opening a channel", () => {
  test("paints the cached history after one round trip: roster, requests and head go out together", async () => {
    const r = relay()
    const steps = r.make(400, range(1, 400), null)
    warmUp(steps, undefined, 2000)
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
    warmUp(steps, undefined, 2000)
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
    warmUp(steps, undefined, 2000)
    const opening = openChannel(steps, undefined, 2000)
    await r.settle()
    await r.roundTrip()
    await opening
    expect(r.log.filter((l) => l.startsWith("snapshot"))).toEqual([])
  })

  test("no cache on a long channel: the snapshot goes out with head, once", async () => {
    const r = relay()
    const steps = r.make(5000, [], 3000)
    warmUp(steps, undefined, 2000)
    void openChannel(steps, undefined, 2000)
    await r.settle()
    await r.roundTrip()
    expect(r.log.filter((l) => l.startsWith("snapshot"))).toEqual(["snapshot@0"])
    expect(r.painted).toEqual([{ at: 1, seqs: [], base: 3000 }])
  })

  test("a kept state paints the channel before any round trip, from the cache and the kept base", async () => {
    const r = relay()
    const steps = r.make(5000, range(3001, 5000), 3000, kept(3000))
    warmUp(steps, undefined, 2000)
    void openChannel(steps, undefined, 2000)
    await r.settle()
    expect(r.early).toEqual([{ at: 0, seqs: range(3001, 5000), base: 3000 }])
    expect(r.log.filter((l) => l.startsWith("snapshot"))).toEqual([])
    await r.roundTrip()
    expect(r.painted).toEqual([{ at: 1, seqs: range(3001, 5000), base: 3000 }])
  })

  test("a kept base folded under older rules asks for the snapshot, and the snapshot is folded on (#1116)", async () => {
    const r = relay()
    const steps = r.make(5000, range(3001, 5000), 3400, { ...kept(3200), base: { ...base(3200), rules: 0 } })
    const opened = openChannel(steps, undefined, 2000)
    await r.roundTrip()
    await r.roundTrip()
    await r.roundTrip()
    await opened
    expect(r.log.some((l) => l.startsWith("snapshot"))).toBe(true)
    expect(r.painted.at(-1)?.base).toBe(3400)
  })

  test("a cache from seq 1 next to a kept base from older rules still asks for the snapshot, and folds on it (#1116)", async () => {
    const r = relay()
    const steps = r.make(20, range(1, 20), 15, { ...kept(10), base: { ...base(10), rules: 0 } })
    const opened = openChannel(steps, undefined, 2000)
    await r.roundTrip()
    await r.roundTrip()
    await opened
    expect(r.log.some((l) => l.startsWith("snapshot"))).toBe(true)
    expect(r.painted.at(-1)?.base).toBe(15)
  })

  test("a cache from seq 1 with a message it couldn't read keeps the older-rules base, which still holds what that message said", async () => {
    const r = relay()
    const steps = r.make(3, [1, 3], null, { ...kept(2), base: { ...base(2), rules: 0 } })
    const opened = openChannel(steps, undefined, 2000)
    await r.roundTrip()
    await r.roundTrip()
    await opened
    expect(r.painted.at(-1)?.base).toBe(2)
  })

  test("a current-rules snapshot that ends before an older kept base doesn't replace it, so nothing between them is lost", async () => {
    const r = relay()
    const steps = r.make(3, [1, 3], 1, { ...kept(2), base: { ...base(2), rules: 0 } })
    const opened = openChannel(steps, undefined, 2000)
    await r.roundTrip()
    await r.roundTrip()
    await opened
    expect(r.log.some((l) => l.startsWith("snapshot"))).toBe(true)
    expect(r.painted.at(-1)?.base).toBe(2)
  })

  test("a kept base that doesn't reach the cache's first message still asks for the snapshot", async () => {
    const r = relay()
    const steps = r.make(5000, range(3001, 5000), 3000, kept(1000))
    warmUp(steps, undefined, 2000)
    void openChannel(steps, undefined, 2000)
    await r.settle()
    expect(r.early.map((e) => e.at)).toEqual([0])
    expect(r.log).toContain("snapshot@0")
    await r.roundTrip()
    expect(r.painted).toEqual([{ at: 1, seqs: range(3001, 5000), base: 3000 }])
  })

  test("no kept state: nothing paints before the relay answers", async () => {
    const r = relay()
    const steps = r.make(400, range(1, 400), null)
    warmUp(steps, undefined, 2000)
    void openChannel(steps, undefined, 2000)
    await r.settle()
    expect(r.early).toEqual([])
    await r.roundTrip()
    expect(r.painted.map((p) => p.at)).toEqual([1])
  })

  test("a kept base past the relay's head is left out: the snapshot is asked for and painted instead", async () => {
    const r = relay()
    const steps = r.make(5000, range(3001, 5000), 3000, kept(6000))
    void openChannel(steps, undefined, 2000)
    await r.settle()
    await r.roundTrip()
    await r.roundTrip()
    expect(r.log).toContain("snapshot@1")
    expect(r.painted).toEqual([{ at: 2, seqs: range(3001, 5000), base: 3000 }])
  })

  test("an island the early paint showed, which the relay's head turns down, is gone once the relay answers: no old rows above a gap", async () => {
    const r = relay()
    let shown: Message[] = []
    const early = new Set<number>()
    let base: number | null = null
    const cache = range(1001, 1400)
    const steps = onceEach({
      ...r.make(5000, cache, 3000, kept(1000)),
      plan: async (c, head): Promise<Planned> => {
        const plan = planReload(
          c.opened.map((m) => m.seq),
          head,
          2000
        )
        const keep = new Set(plan.keep)
        return { messages: c.opened.filter((m): m is Message => keep.has(m.seq) && !("unread" in m)), unread: [], firstSeq: plan.keep[0], since: plan.since }
      },
      early: (cached, k) => {
        for (const m of cached?.messages ?? []) early.add(m.seq)
        shown = handOver(shown, new Set(), cached?.messages ?? [])
        base = k.base?.n ?? null
      },
      paint: (cached, b) => {
        shown = handOver(shown, early, cached?.messages ?? [])
        base = b?.n ?? null
      },
    })
    warmUp(steps, undefined, 2000)
    const opening = openChannel(steps, undefined, 2000)
    await r.settle()
    expect(shown.map((m) => m.seq)).toEqual(cache)
    await r.roundTrip()
    await r.roundTrip()
    await opening
    expect(shown).toEqual([])
    expect(base).toBe(3000)
  })

  test("the hand-over keeps what the plan keeps and drops only what the early paint added", () => {
    const early = new Set([1, 2, 3])
    expect(handOver([1, 2, 3, 9].map(msg), early, [2, 3, 4].map(msg)).map((m) => m.seq)).toEqual([2, 3, 4, 9])
  })
})
