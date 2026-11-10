import { expect, test } from "bun:test"

import { clock } from "~/kit/time"

const asBefore = (at: number): string => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

test("the cached formatter says what toLocaleTimeString said, minute by minute over a day", () => {
  const start = Date.UTC(2026, 10, 10, 0, 0)
  for (let i = 0; i < 24 * 60; i += 7) expect(clock(start + i * 60_000)).toBe(asBefore(start + i * 60_000))
})

test("a time that isn't a date still renders instead of throwing", () => {
  expect(clock(Number.NaN)).toBe(asBefore(Number.NaN))
})
