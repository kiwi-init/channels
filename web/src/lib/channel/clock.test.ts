import { describe, expect, test } from "bun:test"
import { subscribeTick, tickOf, tickTimers } from "./clock"

describe("the channel clock", () => {
  test("holds still within its interval, so a render in between folds nothing new", () => {
    expect(tickOf(1_700_000_000_000, 15_000)).toBe(1_700_000_000_000 - (1_700_000_000_000 % 15_000))
    const start = tickOf(1_700_000_005_000, 15_000)
    for (let at = start; at < start + 15_000; at += 999) expect(tickOf(at, 15_000)).toBe(start)
    expect(tickOf(start + 15_000, 15_000)).toBe(start + 15_000)
  })

  test("every subscriber to one interval shares one timer, gone with the last of them", () => {
    const before = tickTimers()
    const stops = Array.from({ length: 120 }, () => subscribeTick(30_000, () => {}))
    const other = subscribeTick(60_000, () => {})
    expect(tickTimers()).toBe(before + 2)
    for (const stop of stops.slice(1)) stop()
    expect(tickTimers()).toBe(before + 2)
    stops[0]!()
    other()
    expect(tickTimers()).toBe(before)
  })
})
