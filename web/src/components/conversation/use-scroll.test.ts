import { describe, expect, test } from "bun:test"

import { arrivedAfter } from "./use-scroll"
import { unreadOf } from "./use-news"

describe("what counts as new", () => {
  test("only messages newer than the newest one seen, so clearing a search or showing older ones adds none", () => {
    const seen = 40
    expect(arrivedAfter([{ seq: 38 }, { seq: 39 }, { seq: 40 }], seen)).toBe(0)
    expect(arrivedAfter([{ seq: 1 }, { seq: 2 }, { seq: 39 }, { seq: 40 }, { seq: 41 }, { seq: 42 }], seen)).toBe(2)
    expect(arrivedAfter([{ seq: 5 }, { seq: 6 }], 0)).toBe(2)
  })

  test("unread in a hidden window never goes below zero when history is trimmed", () => {
    expect(unreadOf(true, 12, 10, 0)).toBe(2)
    expect(unreadOf(true, 4, 10, 0)).toBe(0)
    expect(unreadOf(false, 4, 10, 3)).toBe(3)
  })
})
