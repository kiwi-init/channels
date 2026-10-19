import { expect, test } from "bun:test"

import { markSeenIn, seenIn } from "./threads"

test("what's been seen where keeps the newest 500 places, dropping the ones seen longest ago", () => {
  const room = "seen-prune-room"
  markSeenIn(room, Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`task:${i + 1}`, i + 1])))
  const seen = seenIn(room)
  expect(Object.keys(seen)).toHaveLength(500)
  expect(seen["task:1"]).toBeUndefined()
  expect(seen["task:100"]).toBeUndefined()
  expect(seen["task:101"]).toBe(101)
  expect(seen["task:600"]).toBe(600)
})
