import { describe, expect, test } from "bun:test"

import { INTENT_MS, wantsFocus, type Intent } from "~/nav"
import type { Where } from "~/model"

const row = { row: "design" }
const design: Where = { kind: "room", room: "design" }
const general: Where = { kind: "room", room: "general" }
const atlas: Where = { kind: "dm", with: "atlas" }
const opened = (where: string | null, channel = "kiwi"): Intent => ({ channel, where, from: row, at: 1000 })
type Desk = { active: unknown; dialog: boolean; now: number }
type Target = { channel: string; where: Where; writable: boolean }
const desk = (over: Partial<Desk> = {}): Desk => ({ active: row, dialog: false, now: 1100, ...over })
const at = (channel: string, where: Where, inThread?: number): Target => ({ channel, where, writable: inThread === undefined })
const wants = (intent: Intent | null, to: Target, on: Desk) => wantsFocus(intent, to.channel, to.where, to.writable, on.active, on.dialog, on.now)

describe("focusing the composer after a deliberate open (#2376)", () => {
  test("the room that was opened takes focus while focus still sits on the row that opened it", () => {
    expect(wants(opened("r:design"), at("kiwi", design), desk())).toBe(true)
  })

  test("and when the row went away and focus fell back to the page", () => {
    expect(wants(opened("r:design"), at("kiwi", design), desk({ active: null }))).toBe(true)
  })

  test("a DM opened from the sidebar takes focus too", () => {
    expect(wants(opened("d:atlas"), at("kiwi", atlas), desk())).toBe(true)
  })

  test("switching channels focuses whichever writable conversation that channel opens on", () => {
    expect(wants(opened(null, "landing"), at("landing", general), desk({ active: null }))).toBe(true)
    expect(wants(opened(null, "landing"), at("landing", atlas), desk({ active: null }))).toBe(true)
  })

  test("another room's or channel's composer doesn't take it", () => {
    expect(wants(opened("r:design"), at("kiwi", general), desk())).toBe(false)
    expect(wants(opened("r:design"), at("landing", design), desk())).toBe(false)
    expect(wants(opened(null, "landing"), at("kiwi", general), desk())).toBe(false)
  })

  test("a thread composer never takes it", () => {
    expect(wants(opened("r:design"), at("kiwi", design, 12), desk())).toBe(false)
  })

  test("a member who can only read gets no focus in a room, a DM or a channel they switch to", () => {
    const reader = (where: Where): Target => ({ ...at("kiwi", where), writable: false })
    expect(wants(opened("r:design"), reader(design), desk())).toBe(false)
    expect(wants(opened("d:atlas"), reader(atlas), desk())).toBe(false)
    expect(wants(opened(null), reader(general), desk({ active: null }))).toBe(false)
  })

  test("nothing is focused without a deliberate open: arrivals, draft sync and re-renders", () => {
    expect(wants(null, at("kiwi", design), desk({ active: null }))).toBe(false)
  })

  test("it doesn't steal focus from search or another input the person moved to while it loaded", () => {
    expect(wants(opened("r:design"), at("kiwi", design), desk({ active: { search: true } }))).toBe(false)
  })

  test("nor from an open dialog", () => {
    expect(wants(opened("r:design"), at("kiwi", design), desk({ dialog: true }))).toBe(false)
    expect(wants(opened("r:design"), at("kiwi", design), desk({ active: null, dialog: true }))).toBe(false)
  })

  test("an open that never got a composer goes stale instead of firing much later", () => {
    expect(wants(opened("r:design"), at("kiwi", design), desk({ now: 1000 + INTENT_MS }))).toBe(true)
    expect(wants(opened("r:design"), at("kiwi", design), desk({ now: 1001 + INTENT_MS }))).toBe(false)
  })
})
