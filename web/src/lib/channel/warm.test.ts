import { describe, expect, test } from "bun:test"
import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts"
import { dropWarm, heldWindow, keepWarm, warmOf, type Warm } from "./warm"

const msg = (seq: number): Message => ({ v: PROTOCOL_VERSION, id: `id-${seq}`, from: "atlas", kind: "msg", body: `m${seq}`, ts: 1_700_000_000_000 + seq, seq, sigOk: true })
const held = (seqs: number[], unread: number[] = []): Warm => ({ messages: seqs.map(msg), unread, roster: [], requests: [], marks: new Map(), guardFloor: null, roomsFloor: null, base: null })
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

describe("a channel's warm copy, kept for this session", () => {
  test("is per channel, and gone once dropped", () => {
    keepWarm("mc2-a", held([1, 2]))
    keepWarm("mc2-b", held([7]))
    expect(warmOf("mc2-a")?.messages.map((m) => m.seq)).toEqual([1, 2])
    expect(warmOf("mc2-b")?.messages.map((m) => m.seq)).toEqual([7])
    dropWarm("mc2-a")
    expect(warmOf("mc2-a")).toBeUndefined()
    expect(warmOf("mc2-b")).toBeDefined()
    dropWarm("mc2-b")
  })

  test("a copy that holds the window follows from its last message, with no cache read", () => {
    expect(heldWindow(held(range(1, 400)), 400, 2000)).toEqual({ since: 400, firstSeq: 1 })
    expect(heldWindow(held(range(1, 400)), 412, 2000)).toEqual({ since: 400, firstSeq: 1 })
    expect(heldWindow(held(range(1, 2400)), 2400, 2000)).toEqual({ since: 2400, firstSeq: 401 })
  })

  test("no copy, a gap in it, or one that ends before the window: read the cache as before", () => {
    expect(heldWindow(undefined, 400, 2000)).toBeNull()
    expect(heldWindow(held([]), 400, 2000)).toBeNull()
    expect(heldWindow(held([1, 2, 4]), 400, 2000)).toBeNull()
    expect(heldWindow(held([1, 2, 4], [3]), 4, 2000)).toEqual({ since: 4, firstSeq: 1 })
    expect(heldWindow(held(range(1, 10)), 5000, 2000)).toBeNull()
  })
})
