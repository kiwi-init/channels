import { describe, expect, test } from "bun:test"

import { moveWords } from "~/panels/task-moves"
import { DEMO_CHANNEL as channel } from "~/demo/data"

describe("task activity words", () => {
  test("naming yourself the reviewer reads as taking the review", () => {
    expect(moveWords(channel, { seq: 1, by: "jow", at: 0, what: "reviewer", to: "jow" })).toBe("took the review")
  })

  test("naming someone else still asks them", () => {
    expect(moveWords(channel, { seq: 2, by: "jow", at: 0, what: "reviewer", to: "atlas" })).toBe("asked atlas to review it")
  })
})
