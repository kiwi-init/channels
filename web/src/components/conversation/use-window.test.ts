import { describe, expect, test } from "bun:test"

import { trimmedFrom } from "./use-window"

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
