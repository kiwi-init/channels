import { describe, expect, test } from "bun:test"

import { untilIdle } from "~/calm/idle"
import { calmRows } from "~/calm/rows"
import type { ChannelTile, HomeChannel } from "~/model"

const tile = (code: string, over: Partial<ChannelTile> = {}): ChannelTile => ({ code, title: code, state: "member", unread: 0, needsYou: 0, last: 0, ...over })

const home = (code: string, over: Partial<HomeChannel> = {}): HomeChannel => ({
  code,
  title: code,
  lead: null,
  leadName: null,
  working: 0,
  asks: [],
  moving: [],
  more: 0,
  doneToday: 0,
  red: 0,
  agents: [],
  said: null,
  ...over,
})

describe("the calm sky's channels", () => {
  test("the ones that need you come first, then the most recent, and a muted one only when it needs you", () => {
    const rows = calmRows(
      [tile("old", { last: 1 }), tile("fresh", { last: 9 }), tile("asks", { needsYou: 2, last: 0 }), tile("hushed", { muted: true, last: 20 }), tile("loud", { muted: true, needsYou: 1 })],
      []
    )
    expect(rows.map((r) => [r.code, r.needs])).toEqual([
      ["asks", 2],
      ["loud", 1],
      ["fresh", 0],
      ["old", 0],
    ])
  })

  test("channels still waiting to be let in, or gone, stay off it, and it shows 8 at most", () => {
    const tiles = [tile("waiting", { state: "waiting" }), tile("gone", { state: "gone" }), ...Array.from({ length: 10 }, (_, i) => tile(`c${i}`, { last: 10 - i }))]
    expect(calmRows(tiles, []).map((r) => r.code)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"])
  })

  test("its one line is the task that's moving, else the last thing said in #general, else nothing", () => {
    const rows = calmRows(
      [tile("busy", { last: 3 }), tile("talk", { last: 2 }), tile("still", { last: 1 })],
      [
        home("busy", { moving: [{ id: 4, title: "Top bar buttons", who: "megatron", state: "in review", busy: true, red: false }] }),
        home("talk", { said: { from: "jow", at: 0, text: "ship  it\ntoday" } }),
        home("still"),
      ]
    )
    expect(rows.map((r) => r.line)).toEqual(["megatron · Top bar buttons · in review", "jow: ship it today", null])
  })

  test("a long line ends in an ellipsis", () => {
    const [row] = calmRows([tile("c")], [home("c", { said: { from: "a", at: 0, text: "x".repeat(200) } })])
    expect(row?.line?.length).toBe(90)
    expect(row?.line?.endsWith("…")).toBe(true)
  })
})

describe("the idle wait", () => {
  test("counts from the last input, and is over once the wait has passed", () => {
    expect(untilIdle(1000, 1000, 180_000)).toBe(180_000)
    expect(untilIdle(1000, 61_000, 180_000)).toBe(120_000)
    expect(untilIdle(1000, 181_000, 180_000)).toBe(0)
    expect(untilIdle(1000, 999_000, 180_000)).toBe(0)
  })
})
