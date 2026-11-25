import { describe, expect, test } from "bun:test"

import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type ChannelState, type Roster } from "@kiwi/core/state.ts"
import { folded } from "@kiwi/core/state/fold-on.ts"
import { same } from "@kiwi/core/state/same.ts"
import { rendered } from "~/live/rendered"
import { shownSame, wordsRaw, wrote } from "~/words"
import { messagesOf, rowCache, type Pictures, type RowCache } from "~/live/map"
import { rng, roster as streamRoster, SEC, stream } from "../../../test/fold-stream.ts"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent" },
  { name: "ann", pk: "pk-ann", owner: false, at: 0, active: true, kind: "agent" },
]

let next = 0
const wire = (over: Partial<Wire>): Wire => {
  next++
  return { v: 1, id: `w${next}`, seq: next, from: "win", pk: `pk-${over.from ?? "win"}`, sigOk: true, kind: "msg", body: `hi ${next}`, ts: next * 1000, rts: next * 1000, ...over } as Wire
}
const waiting: Pictures = { get: (seq, i, alt) => ({ spot: `${seq}:${i}`, alt, state: "waiting" }) }
const loaded: Pictures = { get: (_seq, _i, alt) => ({ url: "blob:shown", width: 4, height: 3, alt }) }
const oracle = (log: Wire[], me = "jow", pictures = waiting, people = roster) => messagesOf(fold(log, people, 0), log, me, new Map(), pictures, [])

const fresh = () => {
  next = 0
  const log = [wire({}), wire({ from: "ann" }), wire({ re: [1] }), wire({ from: "ann", imgs: [{ name: "a.png", mime: "image/png", size: 1, hash: "h" }] as Wire["imgs"] })]
  return { log, cache: rowCache() }
}

const shown = (state: ChannelState, log: Wire[], cache: RowCache, me = "jow", pictures = waiting) => messagesOf(state, log, me, new Map(), pictures, [], cache)

describe("message rows are kept between new messages (T17818)", () => {
  test("a chat append keeps every other row as the same object", () => {
    const { log, cache } = fresh()
    const f = folded(log, roster, 0)
    const before = shown(f.state, log, cache)
    const more = [...log, wire({})]
    const after = shown(f.next([more.at(-1)!], 0)!, more, cache)
    expect(rendered(after)).toEqual(rendered(oracle(more)))
    for (const [i, row] of before.entries()) expect(after[i]).toBe(row)
  })

  test("a reaction on an older message makes only that row new", () => {
    const { log, cache } = fresh()
    const f = folded(log, roster, 0)
    const before = shown(f.state, log, cache)
    const more = [...log, wire({ kind: "event", body: "", ev: { op: "react", seq: 2, emoji: "👍" } })]
    const after = shown(f.next([more.at(-1)!], 0)!, more, cache)
    expect(rendered(after)).toEqual(rendered(oracle(more)))
    expect(after.find((m) => m.seq === 2)?.reactions).toEqual([{ emoji: "👍", by: ["win"] }])
    for (const row of before) if (row.seq !== 2) expect(after.find((m) => m.seq === row.seq)).toBe(row)
    expect(after.find((m) => m.seq === 2)).not.toBe(before.find((m) => m.seq === 2))
  })

  test("an image that loads shows in its row", () => {
    const { log, cache } = fresh()
    const state = fold(log, roster, 0)
    shown(state, log, cache)
    const after = shown(state, log, cache, "jow", loaded)
    expect(rendered(after)).toEqual(rendered(oracle(log, "jow", loaded)))
    expect(after.find((m) => m.seq === 4)?.images?.[0]).toMatchObject({ url: "blob:shown" })
  })

  test("another seat, or a member who changes, gives the rows a fresh fold gives", () => {
    const { log, cache } = fresh()
    const state = fold(log, roster, 0)
    shown(state, log, cache)
    expect(rendered(shown(state, log, cache, "ann"))).toEqual(rendered(oracle(log, "ann")))
    const renamed = roster.map((m) => (m.name === "ann" ? { ...m, display: "Ann" } : m))
    expect(rendered(shown(fold(log, renamed, 0), log, cache))).toEqual(rendered(oracle(log, "jow", waiting, renamed)))
  })

  test("a link to a pull request follows the pull request's state", () => {
    next = 0
    const cache = rowCache()
    const log = [wire({ body: "see https://github.com/kiwi/channels/pull/7" })]
    const github = (state: "open" | "merged") =>
      wire({
        kind: "event",
        body: "",
        ev: { op: "github", items: [{ kind: "pr", repo: "kiwi/channels", number: 7, title: "x", url: "https://github.com/kiwi/channels/pull/7", state, at: next * 1000 }] } as Wire["ev"],
      })
    const open = [...log, github("open")]
    const merged = [...open, github("merged")]
    expect(rendered(shown(fold(open, roster, 0), open, cache))).toEqual(rendered(oracle(open)))
    expect(rendered(shown(fold(merged, roster, 0), merged, cache))).toEqual(rendered(oracle(merged)))
  })

  test("two channels with the same seqs keep their own rows", () => {
    const { log, cache } = fresh()
    const other = log.map((m) => ({ ...m, body: `other ${m.seq}` }))
    const theirs = rowCache()
    expect(rendered(shown(fold(log, roster, 0), log, cache))).toEqual(rendered(oracle(log)))
    expect(rendered(shown(fold(other, roster, 0), other, theirs))).toEqual(rendered(oracle(other)))
    expect(rendered(shown(fold(log, roster, 0), log, cache))).toEqual(rendered(oracle(log)))
  })

  test("rows of messages no longer held leave the cache", () => {
    const { log, cache } = fresh()
    shown(fold(log, roster, 0), log, cache)
    const trimmed = log.slice(2)
    shown(fold(trimmed, roster, 0), trimmed, cache)
    expect([...cache.rows.keys()].sort()).toEqual([3, 4])
  })

  test("over seeded streams, rows built on the cache equal rows from a fresh fold", () => {
    let steps = 0
    for (let seed = 1; seed <= 15; seed++) {
      const r = rng(seed * 7)
      const { messages, times } = stream(seed, 120)
      const people = streamRoster()
      const cache = rowCache()
      let f = folded(messages.slice(0, 20), people, times[19]!)
      let at = 20
      while (at < messages.length) {
        const n = 1 + Math.floor(r() * 5)
        const batch = messages.slice(at, at + n)
        at += batch.length
        const now = times[at - 1]! + (r() < 0.2 ? 400 * SEC : 0)
        const held = messages.slice(0, at)
        const state = f.next(batch, now) ?? (f = folded(held, people, now)).state
        const me = r() < 0.1 ? "win" : "jow"
        expect(rendered(shown(state, held, cache, me))).toEqual(rendered(messagesOf(fold(held, people, now), held, me, new Map(), waiting, [])))
        steps++
      }
    }
    expect(steps).toBeGreaterThan(300)
  }, 120_000)
  test("an event row whose text changes is built again while the cache context stays (review #17915)", () => {
    next = 0
    const cache = rowCache()
    const log = [
      wire({ from: "jow", pk: "pk-jow", kind: "event", body: "", ev: { op: "task.add", title: "Old title" } }),
      wire({ from: "jow", pk: "pk-jow", kind: "event", body: "", ev: { op: "task.update", task: 1, note: "a note" } }),
    ]
    const state = fold(log, roster, 0)
    const before = shown(state, log, cache)
    const task = state.tasks.get(1)!
    const renamed = { ...state, tasks: new Map([[1, { ...task, title: "New title" }]]) } as ChannelState
    const cached = shown(renamed, log, cache)
    const uncached = messagesOf(renamed, log, "jow", new Map(), waiting, [])
    const text = (rows: typeof before, seq: number) => wordsRaw(rows.find((m) => m.seq === seq)!.text)
    expect(text(before, 2)).toContain("Old title")
    expect(text(uncached, 2)).toContain("New title")
    expect(text(cached, 2)).toBe(text(uncached, 2))
    expect(rendered(cached)).toEqual(rendered(uncached))
  })

  test("rows compare their words by text, also nested", () => {
    expect(shownSame(wrote("a"), wrote("b"))).toBe(false)
    expect(shownSame(wrote("a"), wrote("a"))).toBe(true)
    expect(shownSame({ notes: [{ text: wrote("a") }] }, { notes: [{ text: wrote("b") }] })).toBe(false)
    expect(shownSame(new Map([[1, [{ text: wrote("a") }]]]), new Map([[1, [{ text: wrote("a") }]]]))).toBe(true)
    expect(same(wrote("a"), wrote("a"))).toBe(false)
  })
})
