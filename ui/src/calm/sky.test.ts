import { afterAll, describe, expect, test } from "bun:test"
import { statSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

let reduced = false
const had = Object.getOwnPropertyDescriptor(globalThis, "window")
Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: () => ({ matches: reduced }) } })
afterAll(() => {
  if (had) Object.defineProperty(globalThis, "window", had)
  else Reflect.deleteProperty(globalThis, "window")
})
const { default: Sky } = await import("~/calm/sky")

describe("the Calm sky is Jow's loop, bundled with the app (T4204)", () => {
  test("it plays muted, looping and inline, over its still frame, filling its parent and taking no input", () => {
    reduced = false
    const html = renderToStaticMarkup(createElement(Sky))
    expect(html).toContain('aria-hidden="true"')
    expect(html).toMatch(/<video[^>]* muted=""[^>]* loop=""[^>]* playsinline=""/i)
    expect(html).toMatch(/src="[^"]*idle-loop[^"]*\.mp4"/)
    expect(html).toMatch(/poster="[^"]*idle-still[^"]*\.jpg"/)
    expect(html).toMatch(/position:absolute;.*inset:0/)
    expect(html).toContain("pointer-events:none")
    expect(html).toContain("object-fit:cover")
  })

  test("with reduced motion it shows the still frame and no video", () => {
    reduced = true
    const html = renderToStaticMarkup(createElement(Sky))
    expect(html).not.toContain("<video")
    expect(html).toMatch(/url\([^)]*idle-still[^)]*\.jpg\)/)
  })

  test("the loop stays near 2 MB, so the UI package every client downloads grows by little", () => {
    expect(statSync(join(import.meta.dir, "idle-loop.mp4")).size).toBeLessThan(2_200_000)
    expect(statSync(join(import.meta.dir, "idle-still.jpg")).size).toBeLessThan(300_000)
  })
})
