import { describe, expect, test } from "bun:test"

import type { FoldBase } from "@kiwi/core/state.ts"

import { FOLD_RULES } from "@kiwi/core/protocol.ts"

import { baseFrom, newestRules, startsWhole, usableBase } from "./base-plan"

const at = (n: number) => ({ n }) as FoldBase

describe("folding the app's window on top of the channel's snapshot", () => {
  test("the window must follow straight on from the snapshot", () => {
    expect(baseFrom(1500, 1501)).toBe(1500)
    expect(baseFrom(1500, undefined)).toBe(1500)
    expect(baseFrom(1500, 1200)).toBe(1199)
  })

  test("a snapshot older than the window leaves a gap, so it isn't used", () => {
    expect(usableBase(at(1800), 1500)?.n).toBe(1800)
    expect(usableBase(at(1500), 1500)?.n).toBe(1500)
    expect(usableBase(at(1400), 1500)).toBeNull()
    expect(usableBase(null, 1500)).toBeNull()
  })

  test("past the window, a snapshot that meets the window makes the fold whole, so the owner's automation runs", () => {
    expect(startsWhole(2500, 2000, 500, undefined, at(500))).toBe(true)
    expect(startsWhole(2500, 2000, 500, undefined, at(900))).toBe(true)
    expect(startsWhole(2500, 2000, 500, undefined, at(499))).toBe(false)
    expect(startsWhole(2500, 2000, 500, undefined, null)).toBe(false)
  })

  test("a cached run that starts earlier needs the snapshot to reach the run's first message", () => {
    expect(startsWhole(2500, 2000, 2400, 1200, at(1199))).toBe(true)
    expect(startsWhole(2500, 2000, 2400, 1200, at(1100))).toBe(false)
  })

  test("a log inside the window is whole on its own, and a cache after a gap only with a snapshot over the gap", () => {
    expect(startsWhole(1500, 2000, 0, undefined, null)).toBe(true)
    expect(startsWhole(1500, 2000, 1500, 5, null)).toBe(false)
    expect(startsWhole(1500, 2000, 1500, 5, at(4))).toBe(true)
  })

  test("a base folded under the current fold rules wins over an older-rules one, which is used only when there's nothing else (#1116)", () => {
    const current: FoldBase = { ...at(10), rules: FOLD_RULES }
    const older: FoldBase = { ...at(20), rules: 0 }
    expect(newestRules([older, current])).toBe(current)
    expect(newestRules([current, older])).toBe(current)
    expect(newestRules([null, older])).toBe(older)
    expect(newestRules([null, null])).toBeNull()
  })
})
