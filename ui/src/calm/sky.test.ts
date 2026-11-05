import { afterAll, describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const had = Object.getOwnPropertyDescriptor(globalThis, "window")
Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: () => ({ matches: false }) } })
afterAll(() => {
  if (had) Object.defineProperty(globalThis, "window", had)
  else Reflect.deleteProperty(globalThis, "window")
})
const { BUDGETS, freshPace, pace, scaleFor } = await import("~/calm/clouds")
const { default: Sky } = await import("~/calm/sky")

describe("the Calm sky draws soft clouds within a pixel budget (T4204)", () => {
  test("a laptop window draws below its device pixels, scaled up by the browser", () => {
    const scale = scaleFor(1512, 982, 2)
    expect(scale).toBeLessThan(2)
    expect(1512 * scale * 982 * scale).toBeLessThanOrEqual(BUDGETS[0] + 1)
  })

  test("a small window draws at its device pixels, never more", () => {
    expect(scaleFor(400, 300, 2)).toBe(2)
    expect(scaleFor(400, 300, 1)).toBe(1)
  })

  test("a huge window keeps at least half a pixel per CSS pixel", () => {
    expect(scaleFor(7680, 4320, 2)).toBe(0.5)
  })
})

describe("the sky fills its parent and never takes input (T4204)", () => {
  test("it is a full-bleed layer hidden from assistive tech, under a canvas", () => {
    const html = renderToStaticMarkup(createElement(Sky))
    expect(html).toContain('aria-hidden="true"')
    expect(html).toMatch(/position:absolute;.*inset:0/)
    expect(html).toContain("pointer-events:none")
    expect(html).toContain("<canvas")
  })
})

type Paced = ReturnType<typeof freshPace>
const run = (from: Paced, windows: number, gaps: (i: number) => number): Paced => {
  let p = from
  for (let i = 0; i < windows * 60; i++) p = pace(p, gaps(i))
  return p
}
const slow = (i: number) => (i % 60 < 3 ? 22 : 8.33)

describe("the sky lowers its pixels when frames are missed and raises them when calm (T4204)", () => {
  test("a steady 120 Hz or 60 Hz screen keeps the full budget", () => {
    expect(run(freshPace(), 20, () => 8.33).level).toBe(0)
    expect(run(freshPace(), 20, () => 16.7).level).toBe(0)
  })

  test("missed frames step it down one budget per window, to 700k at the least", () => {
    expect(run(freshPace(), 1, slow).level).toBe(1)
    expect(run(freshPace(), 2, slow).level).toBe(2)
    expect(BUDGETS[run(freshPace(), 6, slow).level]).toBe(700_000)
  })

  test("after ten calm windows it steps back up, and a step up that misses at once waits twice as long next time", () => {
    const down = run(freshPace(), 1, slow)
    expect(run(down, 9, () => 8.33).level).toBe(1)
    const up = run(down, 10, () => 8.33)
    expect(up.level).toBe(0)
    const back = run(up, 1, slow)
    expect(back.level).toBe(1)
    expect(back.patience).toBe(20)
    expect(run(back, 19, () => 8.33).level).toBe(1)
    expect(run(back, 20, () => 8.33).level).toBe(0)
  })
})
