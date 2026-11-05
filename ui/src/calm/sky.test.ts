import { afterAll, describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const had = Object.getOwnPropertyDescriptor(globalThis, "window")
Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: () => ({ matches: false }) } })
afterAll(() => {
  if (had) Object.defineProperty(globalThis, "window", had)
  else Reflect.deleteProperty(globalThis, "window")
})
const { scaleFor } = await import("~/calm/clouds")
const { default: Sky } = await import("~/calm/sky")

describe("the Calm sky draws soft clouds within a pixel budget (T4204)", () => {
  test("a laptop window draws below its device pixels, scaled up by the browser", () => {
    const scale = scaleFor(1512, 982, 2)
    expect(scale).toBeLessThan(2)
    expect(1512 * scale * 982 * scale).toBeLessThanOrEqual(2_000_001)
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
