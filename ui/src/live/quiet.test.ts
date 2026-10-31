import { describe, expect, test } from "bun:test"
import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { readPrefs } from "~/live/prefs"
import { inQuietHours, isMuted, muteKey, silentNow, snoozeEnd, tells } from "~/live/quiet"

const at = (h: number, m = 0): number => new Date(2026, 10, 2, h, m).getTime()
const msg = (over: Partial<Wire>): Wire => ({ v: 1, id: "1", seq: 1, from: "atlas", kind: "msg", body: "build is green", ts: 1, rts: 1, sigOk: true, sig: "", ...over }) as Wire
const base = { notify: "all" as const, muted: [] as string[], snoozeUntil: null, quiet: { on: false, from: 22 * 60, to: 8 * 60 } }

describe("notification controls (T972)", () => {
  test("snooze ends after 1 h, 8 h, or tomorrow at 9:00", () => {
    expect(snoozeEnd("1h", at(14))).toBe(at(15))
    expect(snoozeEnd("8h", at(14))).toBe(at(22))
    expect(snoozeEnd("tomorrow", at(23, 30))).toBe(new Date(2026, 10, 3, 9, 0).getTime())
  })

  test("quiet hours wrap past midnight and are off unless turned on", () => {
    const night = { on: true, from: 22 * 60, to: 8 * 60 }
    expect(inQuietHours(night, at(23))).toBe(true)
    expect(inQuietHours(night, at(3))).toBe(true)
    expect(inQuietHours(night, at(8))).toBe(false)
    expect(inQuietHours(night, at(12))).toBe(false)
    expect(inQuietHours({ on: true, from: 13 * 60, to: 14 * 60 }, at(13, 30))).toBe(true)
    expect(inQuietHours({ ...night, on: false }, at(23))).toBe(false)
  })

  test("paused or in quiet hours, nothing tells, not even a mention", () => {
    const mention = msg({ body: "@jow look" })
    expect(silentNow({ snoozeUntil: at(15), quiet: base.quiet }, at(14))).toBe(true)
    expect(tells(mention, "jow", { ...base, snoozeUntil: at(15) }, "c1", true, at(14))).toBe(false)
    expect(tells(mention, "jow", { ...base, snoozeUntil: at(13) }, "c1", true, at(14))).toBe(true)
  })

  test("a muted channel or room tells only mentions, direct messages and decisions for you", () => {
    const muted = { ...base, muted: [muteKey("c1"), muteKey("c2", "r-ops")] }
    expect(isMuted(muted.muted, "c1")).toBe(true)
    expect(isMuted(muted.muted, "c2", "r-ops")).toBe(true)
    expect(isMuted(muted.muted, "c2", "general")).toBe(false)
    expect(tells(msg({}), "jow", muted, "c1", false, at(12))).toBe(false)
    expect(tells(msg({ body: "@jow look" }), "jow", muted, "c1", false, at(12))).toBe(true)
    expect(tells(msg({ to: ["jow"] }), "jow", muted, "c1", false, at(12))).toBe(true)
    expect(tells(msg({ kind: "ask", esc: true, to: ["owner"] }), "jow", muted, "c1", true, at(12))).toBe(true)
    expect(tells(msg({ room: "r-ops" }), "jow", muted, "c2", false, at(12))).toBe(false)
    expect(tells(msg({}), "jow", muted, "c2", false, at(12))).toBe(true)
  })

  test("saved settings read back, and anything malformed falls back to safe defaults", () => {
    const store = (raw: unknown) => ({ getItem: (k: string) => (k === "ui.prefs" ? JSON.stringify(raw) : "1"), setItem: () => {} })
    const good = readPrefs(store({ muted: ["c1", "c2/r"], snoozeUntil: 5, quiet: { on: true, from: 60, to: 120 }, mentionSound: false }))
    expect([good.muted, good.snoozeUntil, good.quiet, good.mentionSound]).toEqual([["c1", "c2/r"], 5, { on: true, from: 60, to: 120 }, false])
    const bad = readPrefs(store({ muted: [1, "", "c1", "c1"], snoozeUntil: "soon", quiet: { on: "yes", from: 9999 }, mentionSound: 1 }))
    expect([bad.muted, bad.snoozeUntil, bad.quiet, bad.mentionSound]).toEqual([["c1"], null, { on: false, from: 22 * 60, to: 8 * 60 }, true])
  })
})
