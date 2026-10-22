import { describe, expect, test } from "bun:test"

import { awayFrom, trimmedFrom } from "./use-window"

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ seq: i + 1 }))

describe("the mounted window doesn't grow while you read at the bottom", () => {
  test("past twice the window, it drops back to the newest rows once the cut is above the view", () => {
    expect(trimmedFrom(items(400), 150, () => true)).toBe(281)
  })

  test("it leaves the rows alone while the cut would fall in view, or while few are mounted", () => {
    expect(trimmedFrom(items(400), 150, () => false)).toBeNull()
    expect(trimmedFrom(items(400), 200, () => true)).toBeNull()
  })
})

describe("away from the conversation (Tasks or Agents), the window shrinks to a first screen, so coming back mounts only that", () => {
  test("more than the newest 40 rows mounted moves it to the newest 40", () => {
    expect(awayFrom(items(1_000), 0)).toBe(961)
    expect(awayFrom(items(1_000), 700)).toBe(961)
    expect(awayFrom(items(1_000), 800)).toBe(961)
  })

  test("a window already at the first screen, or a short conversation, is left as it is", () => {
    expect(awayFrom(items(1_000), 960)).toBeNull()
    expect(awayFrom(items(30), 0)).toBeNull()
  })
})
