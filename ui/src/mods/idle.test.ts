import { expect, test } from "bun:test"

import { untilIdle } from "~/mods/idle"

test("the idle wait counts from the last input, and is over once the wait has passed", () => {
  expect(untilIdle(1000, 1000, 180_000)).toBe(180_000)
  expect(untilIdle(1000, 61_000, 180_000)).toBe(120_000)
  expect(untilIdle(1000, 181_000, 180_000)).toBe(0)
  expect(untilIdle(1000, 999_000, 180_000)).toBe(0)
})
