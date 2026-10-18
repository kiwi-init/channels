import { describe, expect, test } from "bun:test"
import { formatLeft } from "./format"

describe("formatLeft", () => {
  test("minutes, then hours, then days, never zero", () => {
    const now = 1_700_000_000_000
    expect(formatLeft(now + 10_000, now)).toBe("1m left")
    expect(formatLeft(now + 25 * 60_000, now)).toBe("25m left")
    expect(formatLeft(now + 3 * 3_600_000, now)).toBe("3h left")
    expect(formatLeft(now + 5 * 86_400_000, now)).toBe("5d left")
  })
})
