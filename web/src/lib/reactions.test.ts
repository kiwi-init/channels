import { describe, expect, test } from "bun:test"

import type { ChannelState, Reaction } from "@mc/state.ts"

import { chipLabel, chipsFor } from "./reactions"

const r = (emoji: string, seq: number): Reaction => ({ emoji, seq, at: seq })
const state = (on: [string, Reaction][]) => ({ reactions: new Map([[10, new Map(on)]]) }) as Pick<ChannelState, "reactions">
const name = (n: string) => n.toUpperCase()

describe("reaction chips", () => {
  test("one per emoji, in the order each first came, with who in the order they reacted", () => {
    const chips = chipsFor(
      state([
        ["win", r("👍", 14)],
        ["dev", r("👀", 12)],
        ["me", r("👀", 13)],
      ]),
      10,
      "me",
      name
    )
    expect(chips).toEqual([
      { emoji: "👀", who: ["DEV", "ME"], mine: true },
      { emoji: "👍", who: ["WIN"], mine: false },
    ])
    expect(chipLabel(chips[0]!)).toBe("👀 DEV and ME")
    expect(chipLabel({ emoji: "👍", who: ["A", "B", "C"], mine: false })).toBe("👍 A, B and C")
  })
  test("none: the same empty list every time, so a bubble keeps its memo", () => {
    const s = state([])
    expect(chipsFor(s, 99, "me", name)).toBe(chipsFor(s, 10, "me", name))
    expect(chipsFor(s, 99, "me", name)).toEqual([])
  })
})
