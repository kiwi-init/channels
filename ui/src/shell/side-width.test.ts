import { describe, expect, test } from "bun:test"
import { sidePx, sideRem } from "~/shell/side-width"

describe("the sidebar's width", () => {
  test("a dragged width lands on the 8px grid and is kept in rem", () => {
    expect(sideRem(357, 16) * 16).toBe(360)
    expect(sideRem(355, 16) * 16).toBe(352)
    expect(sideRem(352, 17.6) * 17.6).toBeCloseTo(352)
  })

  test("never narrower than 14rem or wider than 28rem, both on the grid", () => {
    expect(sideRem(40, 16) * 16).toBe(224)
    expect(sideRem(4000, 16) * 16).toBe(448)
    expect(sideRem(40, 17.6) * 17.6).toBeCloseTo(248)
    expect(sideRem(4000, 17.6) * 17.6).toBeCloseTo(488)
  })

  test("on screen it gives way so the work keeps 480px, but never below the default", () => {
    expect(sidePx(18, 17.6, 1710)).toBe(320)
    expect(sidePx(27, 16, 1710)).toBe(432)
    expect(sidePx(27, 16, 1280)).toBe(400)
    expect(sidePx(27, 16, 900)).toBe(288)
    expect(sidePx(14, 16, 900)).toBe(224)
  })
})
