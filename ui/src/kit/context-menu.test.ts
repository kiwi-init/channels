import { describe, expect, test } from "bun:test"

import { fitted, stepped } from "~/kit/context-menu"

describe("right-click menus (T974)", () => {
  test("a menu opens at the pointer when it fits", () => {
    expect(fitted(100, 200, 180, 120, 1200, 800)).toEqual({ left: 100, top: 200 })
  })

  test("near an edge it stays on screen", () => {
    expect(fitted(1190, 790, 180, 120, 1200, 800)).toEqual({ left: 1012, top: 672 })
    expect(fitted(0, 0, 180, 120, 150, 100)).toEqual({ left: 8, top: 8 })
  })

  test("the arrows wrap, and Home and End jump", () => {
    expect(stepped("ArrowDown", -1, 3)).toBe(0)
    expect(stepped("ArrowDown", 2, 3)).toBe(0)
    expect(stepped("ArrowUp", 0, 3)).toBe(2)
    expect(stepped("ArrowUp", 2, 3)).toBe(1)
    expect(stepped("Home", 2, 3)).toBe(0)
    expect(stepped("End", 0, 3)).toBe(2)
    expect(stepped("a", 0, 3)).toBeNull()
  })
})
