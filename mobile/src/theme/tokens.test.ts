import { readFileSync } from "node:fs"
import { join } from "node:path"

import { dark, light, radius, type, type Colors } from "./tokens"

const css = readFileSync(join(__dirname, "../../../web/src/index.css"), "utf8")
const names: Record<keyof Colors, string> = {
  canvas: "canvas",
  rail: "rail",
  raised: "raised",
  field: "field",
  ink: "ink",
  ink2: "ink-2",
  ink3: "ink-3",
  line: "line",
  wash: "wash",
  wash2: "wash-2",
  accent: "accent",
  accentInk: "accent-ink",
  accentText: "accent-text",
  accentWash: "accent-wash",
  link: "link",
  ring: "ring",
  alert: "alert",
  alertFill: "alert-fill",
  decide: "decide",
  decideWash: "decide-wash",
  live: "live",
  doing: "doing",
  warn: "warn",
  overlay: "overlay",
  bubbleMe: "bubble-me",
  bubbleMeInk: "bubble-me-ink",
  bubbleThem: "bubble-them",
  bubbleThemInk: "bubble-them-ink",
  edgeStrong: "edge-strong",
  pick: "pick",
}

type Side = "light" | "dark"

function declared(name: string): string {
  const line = css.split("\n").find((l) => l.trim().startsWith(`--${name}:`))
  if (!line) throw new Error(`--${name} is not in index.css`)
  return line.slice(line.indexOf(":") + 1, line.lastIndexOf(";")).trim()
}

function resolve(name: string, side: Side, seen = 0): string {
  if (seen > 4) throw new Error(`--${name} loops`)
  const value = declared(name)
  const pair = /^light-dark\((.*)\)$/.exec(value)
  if (pair) {
    const parts = pair[1]!.split(/,\s*(?![^(]*\))/)
    return parts[side === "light" ? 0 : 1]!.trim()
  }
  const ref = /^var\(--([\w-]+)\)$/.exec(value)
  return ref ? resolve(ref[1]!, side, seen + 1) : value
}

describe("tokens equal web/src/index.css", () => {
  for (const side of ["light", "dark"] as const) {
    const colors = side === "light" ? light : dark
    it(`${side} colors`, () => {
      for (const key of Object.keys(names) as (keyof Colors)[]) expect([key, colors[key]]).toEqual([key, resolve(names[key], side)])
    })
  }

  it("type steps and radii", () => {
    const px = (name: string): number => Number(/calc\((\d+)px/.exec(declared(name))![1])
    for (const [step, size] of Object.entries(type)) {
      expect(size.fontSize).toBe(px(`text-${step}`))
      expect(size.lineHeight).toBe(px(`text-${step}--line-height`))
    }
    for (const [step, value] of Object.entries(radius)) expect(value).toBe(Number.parseInt(declared(`radius-${step}`), 10))
  })
})

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe("text pairs", () => {
  const surfaces = ["canvas", "rail", "raised", "field"] as const
  const strict = ["ink", "ink2", "ink3"] as const
  const status = ["alert", "decide", "warn"] as const
  const softer = ["accentText", "link", "live", "doing"] as const

  for (const side of ["light", "dark"] as const) {
    const c = side === "light" ? light : dark
    it(`${side}: ink, ink2 and ink3 are at least 4.5:1 on every surface`, () => {
      const low: string[] = []
      for (const surface of surfaces) for (const text of strict) if (contrast(c[text], c[surface]) < 4.5) low.push(`${text} on ${surface}: ${contrast(c[text], c[surface]).toFixed(2)}`)
      expect(low).toEqual([])
    })

    it(`${side}: alert, decide and warn are at least 4.5:1 on canvas, rail and raised`, () => {
      for (const surface of ["canvas", "rail", "raised"] as const) for (const text of status) expect(contrast(c[text], c[surface])).toBeGreaterThanOrEqual(4.5)
    })

    it(`${side}: accent text, link, live and doing are at least 3:1 on every surface (index.css documents the accent as under 4.5 by day)`, () => {
      for (const surface of surfaces) for (const text of softer) expect(contrast(c[text], c[surface])).toBeGreaterThanOrEqual(3)
    })

    it(`${side}: ink on others' bubbles and white on the alert fill are at least 4.5:1`, () => {
      expect(contrast(c.bubbleThemInk, c.bubbleThem)).toBeGreaterThanOrEqual(4.5)
      expect(contrast("#ffffff", c.alertFill)).toBeGreaterThanOrEqual(4.5)
    })
  }

  it("white on the accent is the documented exception: about 4:1 by day", () => {
    expect(contrast(light.accentInk, light.accent)).toBeGreaterThan(3.5)
    expect(contrast(dark.accentInk, dark.accent)).toBeGreaterThanOrEqual(3)
  })
})
