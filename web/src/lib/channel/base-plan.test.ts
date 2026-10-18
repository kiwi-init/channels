import { describe, expect, test } from "bun:test"

import type { FoldBase } from "@kiwi/core/state.ts"

import { baseFrom, usableBase } from "./base-plan"

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
})
