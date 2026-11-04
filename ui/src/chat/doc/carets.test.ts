import { describe, expect, test } from "bun:test"

import { caretShown } from "~/chat/doc/carets"

describe("whose carets the doc draws (T2106)", () => {
  test("another person's caret shows; your own other windows' carets and this window's don't", () => {
    const shown = caretShown("jow")
    expect(shown(1, 2, { user: { name: "atlas" }, kiwi: { author: "atlas", selection: null } })).toBe(true)
    expect(shown(1, 2, { user: { name: "jow" }, kiwi: { author: "jow", selection: { block: "b1", text: "" } } })).toBe(false)
    expect(shown(1, 1, { kiwi: { author: "atlas" } })).toBe(false)
    expect(shown(1, 3, { user: { name: "maya" } })).toBe(true)
    expect(shown(1, 4, null)).toBe(true)
  })
})
