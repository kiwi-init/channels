import { describe, expect, test } from "bun:test"
import { PROTOCOL_VERSION, type Message as Wire } from "@kiwi/core/protocol.ts"
import { withReach } from "~/live/reach"

const wire = (seq: number, body = `m${seq}`): Wire => ({ v: PROTOCOL_VERSION, id: `id-${seq}`, from: "atlas", kind: "msg", body, ts: seq, seq, sigOk: true })

describe("counts and lists read past the window", () => {
  test("lean copies below the window come first, and a whole message wins over its lean copy", () => {
    const reach = [wire(1), wire(2), wire(3, "lean")]
    const shown = [wire(3), wire(4)]
    const merged = withReach(reach, shown, [])
    expect(merged.map((m) => m.seq)).toEqual([1, 2, 3, 4])
    expect(merged[2]).toBe(shown[0])
  })

  test("an open question that left both keeps its place, and nothing to add returns the window itself", () => {
    const shown = [wire(10), wire(11)]
    expect(withReach([], shown, [shown[0]!])).toBe(shown)
    expect(withReach([wire(12)], shown, [])).toBe(shown)
    expect(withReach([], shown, [wire(2)]).map((m) => m.seq)).toEqual([2, 10, 11])
  })
})
