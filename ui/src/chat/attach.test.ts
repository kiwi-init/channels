import { describe, expect, test } from "bun:test"

import { dropTarget } from "~/chat/attach"

describe("a file dropped anywhere on a conversation lands in its composer (T1874)", () => {
  const main = { left: 400, right: 1000, top: 700, bottom: 780 }
  const panel = { left: 1010, right: 1270, top: 720, bottom: 780 }

  test("a drop on the message list, above the composer, goes to that column's composer", () => {
    expect(dropTarget([main, panel], 600, 200)).toBe(0)
    expect(dropTarget([main, panel], 1100, 90)).toBe(1)
  })

  test("a drop on the rail or the sidebar, in no conversation's column, goes nowhere", () => {
    expect(dropTarget([main, panel], 40, 300)).toBe(-1)
    expect(dropTarget([], 600, 200)).toBe(-1)
  })

  test("two boxes in one column: the nearer one takes it", () => {
    const comment = { left: 420, right: 980, top: 300, bottom: 360 }
    expect(dropTarget([main, comment], 600, 250)).toBe(1)
    expect(dropTarget([main, comment], 600, 650)).toBe(0)
    expect(dropTarget([main, comment], 600, 330)).toBe(1)
  })
})
