import { describe, expect, test } from "bun:test"

import { wellFormed, type Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { messagesOf, roomsOf } from "~/live/map"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

let next = 0
const wire = (over: Partial<Wire>): Wire => {
  next++
  return { v: 1, id: `w${next}`, seq: next, from: "win", pk: `pk-${over.from ?? "win"}`, sigOk: true, kind: "msg", body: "hi", ts: next * 1000, rts: next * 1000, ...over } as Wire
}
const pictures = { get: () => ({ spot: "", alt: "", state: "waiting" as const }) }

describe("a reply from an old CLI still says it went only to its thread, and rooms show it anyway (T980, T4143)", () => {
  test("a side reply is a well-formed payload, and side is only ever true", () => {
    const p = { v: 1, id: "x", from: "win", kind: "msg", body: "hi", ts: 1, re: [1] }
    expect(wellFormed({ ...p, side: true })).toBe(true)
    expect(wellFormed({ ...p, side: false })).toBe(false)
    expect(wellFormed({ ...p, side: "yes" })).toBe(false)
  })

  test("a side reply's row says so, a root or a reply sent to the room too doesn't", () => {
    const root = wire({ from: "jow", body: "where does T10 stand?" })
    const side = wire({ re: [root.seq], side: true, body: "in its thread" })
    const also = wire({ re: [root.seq], body: "in the room too" })
    const stray = wire({ side: true, body: "no thread to stay in" })
    const log = [root, side, also, stray]
    const rows = messagesOf(fold(log, roster, 0), log, "jow", new Map(), pictures, [])
    const of = (seq: number) => rows.find((m) => m.seq === seq)
    expect(of(side.seq)).toMatchObject({ inThread: root.seq, side: true })
    expect(of(also.seq)?.inThread).toBe(root.seq)
    expect(of(also.seq)?.side).toBeUndefined()
    expect(of(stray.seq)?.side).toBeUndefined()
    expect(of(root.seq)?.thread?.replies).toBe(2)
  })

  test("a room's unread counts what its feed shows: side replies too, since rooms are flat", () => {
    const root = wire({ body: "T10 is merged" })
    const side = wire({ re: [root.seq], side: true, body: "and tagged" })
    const also = wire({ re: [root.seq], body: "release notes are up" })
    const log = [root, side, also]
    const general = roomsOf(fold(log, roster, 0), log, "jow", {}, 0).find((r) => r.id === "general")
    expect(general?.unread).toBe(3)
  })

  test("a side reply for you still counts, as a mention, so an answer to you never goes unseen", () => {
    const root = wire({ from: "jow", body: "@win can you tag T10?" })
    const toYou = wire({ re: [root.seq], side: true, to: ["jow"], body: "Tagged." })
    const named = wire({ re: [root.seq], side: true, body: "@jow the notes need your OK" })
    const log = [root, toYou, named]
    const general = roomsOf(fold(log, roster, 0), log, "jow", {}, 0).find((r) => r.id === "general")
    expect([general?.unread, general?.mentions]).toEqual([2, 2])
  })
})
