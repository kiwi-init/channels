import { describe, expect, test } from "bun:test"

import { BASE64, cipherText, planRun, poseGlyph, readable, runFocus, runGap, type Pose } from "~/afk/cipher"

const seeded = (s: number) => () => (s = (s * 16807) % 2147483647) / 2147483647
const pose = (): Pose => ({ x: 0, y: 0, z: 0, a: 0, b: 0, mix: 0, form: 0, alpha: 0 })

describe("the meadow's ciphertext", () => {
  test("is base64, with padding only at the end, and never spells a readable word", () => {
    const r = seeded(7)
    for (let i = 0; i < 2000; i++) {
      const n = 6 + (i % 15)
      const s = cipherText(r, n)
      expect(s.length).toBe(n)
      expect(s).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
      expect(readable(s)).toBe(false)
    }
  })

  test("a run of three letters of one case, or four of any, counts as readable", () => {
    expect(readable("x9the+")).toBe(true)
    expect(readable("Q2LOL7")).toBe(true)
    expect(readable("4Cat/0")).toBe(true)
    expect(readable("aB9LoVe")).toBe(true)
    expect(readable("q8Zr+T0aLm1/xN==")).toBe(false)
  })

  test("runs come every 8 to 20 seconds, and each one is over before the next can start", () => {
    const r = seeded(11)
    for (let i = 0; i < 500; i++) {
      const gap = runGap(r)
      expect(gap).toBeGreaterThanOrEqual(8)
      expect(gap).toBeLessThan(20)
      const run = planRun(r, i % 2 ? "air" : "bloom")
      expect(run.end).toBeLessThan(8)
    }
  })

  test("the lens finds a run as it surfaces, keeps it through the scramble, and lets it go before it dissolves", () => {
    const r = seeded(31)
    for (let i = 0; i < 300; i++) {
      const run = planRun(r, i % 2 ? "air" : "bloom")
      expect(runFocus(run, 0)).toBe(0)
      for (const g of run.glyphs) expect(runFocus(run, g.flips.at(-1) ?? 0)).toBeGreaterThan(0.85)
      for (const g of run.glyphs) expect(runFocus(run, g.leave + 0.2)).toBeLessThan(0.05)
    }
  })

  test("a run is 6 to 20 glyphs that scramble through a few characters and settle before they dissolve", () => {
    const r = seeded(23)
    for (let i = 0; i < 300; i++) {
      const run = planRun(r, "air")
      expect(run.glyphs.length).toBeGreaterThanOrEqual(6)
      expect(run.glyphs.length).toBeLessThanOrEqual(20)
      for (const g of run.glyphs) {
        expect(g.flips.length).toBeGreaterThanOrEqual(3)
        expect(g.flips.length).toBeLessThanOrEqual(6)
        expect(g.chars.length).toBe(g.flips.length + 1)
        for (const c of g.chars) expect(c).toBeLessThan(BASE64.length)
        for (let k = 1; k < g.flips.length; k++) expect(g.flips[k]).toBeGreaterThan(g.flips[k - 1] ?? 0)
        expect(g.flips.at(-1) ?? 0).toBeLessThanOrEqual(g.leave - 0.5 + 1e-9)
        expect(g.leave - 1.65).toBeGreaterThanOrEqual(1)
      }
    }
  })

  test("a glyph surfaces from a mote, holds its settled character, then dissolves back into pollen", () => {
    const [g] = planRun(seeded(5), "bloom", 8).glyphs
    if (!g) throw new Error("no glyph")
    const before = poseGlyph(g, g.born - 0.01, pose())
    expect(before.alpha).toBe(0)
    const held = poseGlyph(g, g.leave - 0.05, pose())
    expect(held.form).toBe(1)
    expect(held.alpha).toBe(1)
    expect(held.b).toBe(g.chars.at(-1) ?? -1)
    expect(held.mix).toBe(1)
    expect(held.x).toBeCloseTo(g.slot[0])
    expect(held.y).toBeCloseTo(g.slot[1])
    expect(held.z).toBeCloseTo(g.slot[2])
    const leaving = poseGlyph(g, g.leave + 0.8, pose())
    expect(leaving.form).toBe(0)
    expect(leaving.alpha).toBeGreaterThan(0)
    expect(poseGlyph(g, g.leave + 2, pose()).alpha).toBe(0)
  })
})
