import { describe, expect, test } from "bun:test"

import { daylight, moonPhase } from "~/calm/daylight"

const at = (h: number, m = 0): Date => new Date(2026, 10, 5, h, m)

describe("the idle sky follows the person's clock", () => {
  test("the sun rises on the left at 6, stands highest at noon and sets on the right at 18", () => {
    expect(daylight(at(6)).sun.y).toBeCloseTo(0, 5)
    expect(daylight(at(6)).sun.x).toBeCloseTo(-1, 5)
    expect(daylight(at(12)).sun.y).toBeCloseTo(1, 5)
    expect(daylight(at(12)).sun.x).toBeCloseTo(0, 5)
    expect(daylight(at(18)).sun.y).toBeCloseTo(0, 5)
    expect(daylight(at(18)).sun.x).toBeCloseTo(1, 5)
  })

  test("midday is plain daylight, with no stars and the full light", () => {
    const noon = daylight(at(12))
    expect(noon.stars).toBe(0)
    expect(noon.night).toBe(0)
    expect(noon.look.light).toEqual([1, 1, 1])
  })

  test("the middle of the night has stars, no sun and a dim blue light", () => {
    const night = daylight(at(2))
    expect(night.stars).toBe(1)
    expect(night.night).toBe(1)
    expect(night.sun.show).toBe(0)
    const [r, g, b] = night.look.light
    expect(b).toBeGreaterThan(r)
    expect(Math.max(r, g, b)).toBeLessThan(0.7)
  })

  test("an evening glows warmer than a morning at the same sun height", () => {
    const morning = daylight(at(7)).look.light
    const evening = daylight(at(17)).look.light
    expect(evening[2]).toBeLessThan(morning[2])
  })

  test("the moon's phase is the real one: full on 25 Jan 2024, new on 11 Jan 2024", () => {
    expect(moonPhase(new Date(Date.UTC(2024, 0, 25, 17, 54)))).toBeCloseTo(0.5, 1)
    const fresh = moonPhase(new Date(Date.UTC(2024, 0, 11, 11, 57)))
    expect(Math.min(fresh, 1 - fresh)).toBeLessThan(0.03)
  })

  test("a full moon rises as the sun sets and is high at midnight", () => {
    const full = new Date(Date.UTC(2024, 0, 25, 17, 54))
    const midnight = new Date(full.getFullYear(), full.getMonth(), full.getDate(), 0, 0)
    const m = daylight(new Date(midnight.getTime() + 24 * 3_600_000))
    expect(m.moon.y).toBeGreaterThan(0.9)
    expect(m.moon.show).toBeGreaterThan(0.9)
  })
})
