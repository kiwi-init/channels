import { describe, expect, test } from "bun:test"

import { headMotion, headMoves, type HeadSurroundings } from "./head-motion"

const clear: HeadSurroundings = { focused: true, onScreen: true, reducedMotion: false, held: false }

describe("when the coordinator's head moves", () => {
  test("onboarding heads loop, live heads burst, the rest only play their entrance", () => {
    expect(headMotion(true, true)).toBe("loop")
    expect(headMotion(true, false)).toBe("loop")
    expect(headMotion(false, true)).toBe("burst")
    expect(headMotion(false, false)).toBe("entrance")
  })

  test("a live head moves during its burst and rests after it", () => {
    expect(headMoves("burst", true, clear)).toBe(true)
    expect(headMoves("burst", false, clear)).toBe(false)
    expect(headMoves("entrance", true, clear)).toBe(true)
    expect(headMoves("entrance", false, clear)).toBe(false)
  })

  test("a looping head keeps moving while nothing stops it", () => {
    expect(headMoves("loop", false, clear)).toBe(true)
  })

  test("a window without focus stops every head", () => {
    for (const motion of ["loop", "burst", "entrance"] as const) expect(headMoves(motion, true, { ...clear, focused: false })).toBe(false)
  })

  test("a head out of view stops", () => {
    for (const motion of ["loop", "burst", "entrance"] as const) expect(headMoves(motion, true, { ...clear, onScreen: false })).toBe(false)
  })

  test("reduced motion stops every head, entrance included", () => {
    for (const motion of ["loop", "burst", "entrance"] as const) expect(headMoves(motion, true, { ...clear, reducedMotion: true })).toBe(false)
  })

  test("a channel on hold freezes the head", () => {
    for (const motion of ["loop", "burst", "entrance"] as const) expect(headMoves(motion, true, { ...clear, held: true })).toBe(false)
  })
})
