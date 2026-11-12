import { describe, expect, test } from "bun:test"

import { INTENT_MS, wantsFocus, type Desk, type Intent } from "~/nav"
import type { Where } from "~/model"

const row = { row: "design" }
const design: Where = { kind: "room", room: "design" }
const general: Where = { kind: "room", room: "general" }
const atlas: Where = { kind: "dm", with: "atlas" }
const opened = (where: string | null, channel = "kiwi"): Intent => ({ channel, where, from: row, at: 1000 })
const desk = (over: Partial<Desk> = {}): Desk => ({ active: row, dialog: false, now: 1100, ...over })

describe("focusing the composer after a deliberate open (#2376)", () => {
  test("the room that was opened takes focus while focus still sits on the row that opened it", () => {
    expect(wantsFocus(opened("r:design"), "kiwi", design, undefined, desk())).toBe(true)
  })

  test("and when the row went away and focus fell back to the page", () => {
    expect(wantsFocus(opened("r:design"), "kiwi", design, undefined, desk({ active: null }))).toBe(true)
  })

  test("a DM opened from the sidebar takes focus too", () => {
    expect(wantsFocus(opened("d:atlas"), "kiwi", atlas, undefined, desk())).toBe(true)
  })

  test("switching channels focuses whichever writable conversation that channel opens on", () => {
    expect(wantsFocus(opened(null, "landing"), "landing", general, undefined, desk({ active: null }))).toBe(true)
    expect(wantsFocus(opened(null, "landing"), "landing", atlas, undefined, desk({ active: null }))).toBe(true)
  })

  test("another room's or channel's composer doesn't take it", () => {
    expect(wantsFocus(opened("r:design"), "kiwi", general, undefined, desk())).toBe(false)
    expect(wantsFocus(opened("r:design"), "landing", design, undefined, desk())).toBe(false)
    expect(wantsFocus(opened(null, "landing"), "kiwi", general, undefined, desk())).toBe(false)
  })

  test("a thread composer never takes it", () => {
    expect(wantsFocus(opened("r:design"), "kiwi", design, 12, desk())).toBe(false)
  })

  test("nothing is focused without a deliberate open: arrivals, draft sync and re-renders", () => {
    expect(wantsFocus(null, "kiwi", design, undefined, desk({ active: null }))).toBe(false)
  })

  test("it doesn't steal focus from search or another input the person moved to while it loaded", () => {
    expect(wantsFocus(opened("r:design"), "kiwi", design, undefined, desk({ active: { search: true } }))).toBe(false)
  })

  test("nor from an open dialog", () => {
    expect(wantsFocus(opened("r:design"), "kiwi", design, undefined, desk({ dialog: true }))).toBe(false)
    expect(wantsFocus(opened("r:design"), "kiwi", design, undefined, desk({ active: null, dialog: true }))).toBe(false)
  })

  test("an open that never got a composer goes stale instead of firing much later", () => {
    expect(wantsFocus(opened("r:design"), "kiwi", design, undefined, desk({ now: 1000 + INTENT_MS }))).toBe(true)
    expect(wantsFocus(opened("r:design"), "kiwi", design, undefined, desk({ now: 1001 + INTENT_MS }))).toBe(false)
  })
})
