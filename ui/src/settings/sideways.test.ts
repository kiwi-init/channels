import { describe, expect, test } from "bun:test"
import { sidewaysTarget } from "~/settings/sideways"

describe("a vertical wheel scrolls the narrow settings tabs sideways (T849)", () => {
  test("down moves right and up moves left, within the row", () => {
    expect(sidewaysTarget(0, 300, 0, 100, false)).toBe(100)
    expect(sidewaysTarget(250, 300, 0, 100, false)).toBe(300)
    expect(sidewaysTarget(80, 300, 0, -100, false)).toBe(0)
  })

  test("a wheel that counts lines moves a line's worth each", () => {
    expect(sidewaysTarget(0, 300, 0, 3, true)).toBe(48)
  })

  test("it leaves the wheel alone when the tabs fit, the wheel is already sideways, or the row is at that end", () => {
    expect(sidewaysTarget(0, 0, 0, 100, false)).toBeNull()
    expect(sidewaysTarget(0, 300, 40, 10, false)).toBeNull()
    expect(sidewaysTarget(300, 300, 0, 100, false)).toBeNull()
    expect(sidewaysTarget(0, 300, 0, -100, false)).toBeNull()
  })
})
