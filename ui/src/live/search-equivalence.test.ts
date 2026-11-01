import { describe, expect, test } from "bun:test"

import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts"
import { feed, type Fed } from "../../../desktop/src/search-feed.ts"
import { SearchIndex } from "../../../desktop/src/search-index.ts"
import { messagesOf } from "~/live/map"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human" },
  { name: "maya", pk: "pk-maya", owner: false, at: 0, active: true, kind: "human" },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent" },
]
const pictures = { get: () => ({ spot: "", alt: "", state: "waiting" as const }) }
const WINDOW = 2_000

function fixture(n: number): Wire[] {
  const log: Wire[] = []
  const from = (seq: number) => ["jow", "maya", "win"][seq % 3]!
  const add = (over: Partial<Wire> & { from: string }) => {
    const seq = log.length + 1
    log.push({ v: 1, id: `w${seq}`, seq, pk: `pk-${over.from}`, sigOk: true, kind: "msg", body: `line ${seq} about relays and search`, ts: seq * 1000, rts: seq * 1000, ...over } as Wire)
  }
  while (log.length < n) {
    const seq = log.length + 1
    const who = from(seq)
    if (seq % 50 === 0) add({ from: "mallory", pk: "pk-mallory" })
    else if (seq % 71 === 0) add({ from: "win", pk: "pk-mallory" })
    else if (seq % 31 === 0) add({ from: from(seq - 9), kind: "event", body: "", ev: { op: "msg.edit", seq: seq - 9, body: `edited ${seq - 9} by its author` } })
    else if (seq % 47 === 0) add({ from: from(seq - 21), kind: "event", body: "", ev: { op: "msg.delete", seq: seq - 21 } })
    else if (seq % 89 === 0) add({ from: from(seq - 4 + 1), kind: "event", body: "", ev: { op: "msg.edit", seq: seq - 4, body: `hijacked ${seq - 4}` } })
    else if (seq % 97 === 0) add({ from: "jow", kind: "event", body: "", ev: { op: "task.add", title: `task at ${seq}` } })
    else add({ from: who })
  }
  add({ from: from(4), kind: "event", body: "", ev: { op: "msg.edit", seq: 4, body: "an old line edited late" } })
  add({ from: from(8), kind: "event", body: "", ev: { op: "msg.delete", seq: 8 } })
  return log
}

const shown = (log: Wire[], state: ReturnType<typeof fold>, seqs?: ReadonlySet<number>) =>
  messagesOf(state, log, "jow", new Map(), pictures, [])
    .filter((m) => !m.system && !m.deleted && m.text.trim() && (!seqs || seqs.has(m.seq)))
    .map((m) => ({ seq: m.seq, text: m.text }))

function mainIndex(log: Wire[], batch: number): SearchIndex {
  const index = SearchIndex.empty()
  let fed: Fed = { base: null, through: 0 }
  for (let i = 0; i < log.length; i += batch) fed = feed(index, fed, log.slice(i, i + batch), { roster, roomsFloor: null, guardFloor: null, now: 0 })
  return index
}

describe("main's search index accepts exactly what the app shows (T977)", () => {
  const log = fixture(6_400)
  const indexed = (index: SearchIndex, seqs?: ReadonlySet<number>) =>
    index
      .rows()
      .filter((r) => !seqs || seqs.has(r.seq))
      .map((r) => ({ seq: r.seq, text: r.text }))

  test("over the window the app folds from its base, batch sizes don't matter", () => {
    const cut = log.length - WINDOW
    let base: FoldBase | null = null
    fold(log.slice(0, cut), roster, 0, null, null, null, (b) => (base = b))
    const window = log.slice(cut)
    const app = shown(window, fold(window, roster, 0, null, null, base))
    const seqs = new Set(window.map((m) => m.seq))
    for (const batch of [500, 2_000]) expect(indexed(mainIndex(log, batch), seqs)).toEqual(app.filter((m) => seqs.has(m.seq)))
  })

  test("a log shorter than the fold keeps is the same as one fold of everything", () => {
    const short = fixture(4_000)
    for (const batch of [250, 1_000]) expect(indexed(mainIndex(short, batch))).toEqual(shown(short, fold(short, roster, 0)))
  })

  test("refused, forged, deleted and someone else's edit never become searchable; an edit of a line older than the fold keeps is refused, as the app refuses it", () => {
    const rows = new Map(
      mainIndex(log, 2_000)
        .rows()
        .map((r) => [r.seq, r.text])
    )
    expect(rows.has(50)).toBe(false)
    expect(rows.has(71)).toBe(false)
    expect(rows.has(26)).toBe(false)
    expect(rows.has(8)).toBe(true)
    expect(rows.get(4)).toBe("line 4 about relays and search")
    expect([...rows.values()].some((t) => t.startsWith("hijacked"))).toBe(false)
  })
})
