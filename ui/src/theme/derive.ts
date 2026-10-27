import type { Appearance } from "../model"
import { CHANNELS_DARK, CHANNELS_LIGHT } from "./channels"

export const TOKENS = [
  "bg",
  "bg-2",
  "bg-3",
  "ink",
  "ink-2",
  "ink-3",
  "line",
  "line-2",
  "line-3",
  "wash",
  "wash-2",
  "scrim",
  "link",
  "on-ink",
  "accent",
  "accent-wash",
  "live",
  "doing",
  "review",
  "decide",
  "decide-wash",
  "alert",
  "alert-wash",
  "c-red",
  "c-orange",
  "c-yellow",
  "c-green",
  "c-teal",
  "c-blue",
  "c-indigo",
  "c-violet",
  "c-pink",
  "c-brown",
] as const

type TokenName = (typeof TOKENS)[number]

export type Colors = Record<TokenName, string>

export interface ColorTheme {
  id: string
  name: string
  appearance: Appearance
  colors: Colors
}

export interface Parts {
  appearance: Appearance
  bg: string
  ink: string
  accent: string
  bg2?: string
  bg3?: string
  ink2?: string
  ink3?: string
  live?: string
  doing?: string
  review?: string
  decide?: string
  alert?: string
  red?: string
  yellow?: string
  green?: string
  teal?: string
  blue?: string
  violet?: string
}

type Rgb = readonly [number, number, number]

const FLOORS = { ink: 7, ink2: 6, ink3: 4.5, accent: 4.5, tone: 3 } as const

const STEP = { bg2: 0.035, bg3: 0.04, ink2: 0.32, ink3: 0.46 } as const

const LEVELS = {
  dark: { line: 0.06, line2: 0.09, line3: 0.13, wash: 0.045, wash2: 0.08, accent: 0.14, decide: 0.12, alert: 0.12 },
  light: { line: 0.06, line2: 0.09, line3: 0.13, wash: 0.035, wash2: 0.06, accent: 0.08, decide: 0.1, alert: 0.08 },
} as const

export const isHex = (c: string): boolean => /^#[0-9a-f]{6}$/i.test(c.trim())

function rgb(c: string): Rgb {
  const s = c.trim()
  const six = /^#([0-9a-f]{6})$/i.exec(s)?.[1] ?? /^#([0-9a-f]{3})$/i.exec(s)?.[1]?.replace(/./g, "$&$&")
  if (six) return [parseInt(six.slice(0, 2), 16), parseInt(six.slice(2, 4), 16), parseInt(six.slice(4, 6), 16)]
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0]
}

const byte = (n: number): string =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, "0")

const hexOf = (c: Rgb): string => `#${byte(c[0])}${byte(c[1])}${byte(c[2])}`

export const hex = (c: string): string => hexOf(rgb(c))

function mix(a: string, b: string, t: number): string {
  const x = rgb(a)
  const y = rgb(b)
  return hexOf([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

const linear = (v: number): number => {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

const luminance = (c: string): number => {
  const [r, g, b] = rgb(c)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

export function contrast(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const alpha = (c: string, a: number): string => {
  const [r, g, b] = rgb(c)
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)} / ${Number(a.toFixed(3))})`
}

const spread = (a: string, b: string): number => {
  const x = rgb(a)
  const y = rgb(b)
  return (Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2])) / 3
}

function reach(color: string, toward: string, on: readonly string[], min: number): string {
  for (let i = 0; i <= 50; i++) {
    const next = mix(color, toward, i / 50)
    if (on.every((s) => contrast(next, s) >= min)) return next
  }
  return hex(toward)
}

export function compose(p: Parts): Colors {
  const own = p.appearance === "dark" ? CHANNELS_DARK.colors : CHANNELS_LIGHT.colors
  const level = LEVELS[p.appearance]
  const bg = hex(p.bg)
  const pole = luminance(p.ink) >= luminance(bg) ? "#ffffff" : "#000000"
  const bg2 = hex(p.bg2 ?? mix(bg, p.ink, STEP.bg2))
  const on = [bg, bg2]
  const ink = reach(p.ink, pole, on, FLOORS.ink)
  const bg3 = hex(p.bg3 ?? mix(bg2, ink, STEP.bg3))
  const lift = (c: string, min: number): string => reach(c, ink, on, min)
  const ink2 = lift(p.ink2 ?? mix(ink, bg, STEP.ink2), FLOORS.ink2)
  const ink3 = lift(p.ink3 ?? mix(ink, bg, STEP.ink3), FLOORS.ink3)
  const accent = lift(p.accent, FLOORS.accent)
  const tone = (c: string | undefined, key: TokenName): string => lift(c ?? own[key], FLOORS.tone)
  const red = tone(p.red, "c-red")
  const yellow = tone(p.yellow, "c-yellow")
  const green = tone(p.green, "c-green")
  const teal = tone(p.teal, "c-teal")
  const blue = tone(p.blue, "c-blue")
  const violet = tone(p.violet, "c-violet")
  const orange = tone(mix(red, yellow, 0.5), "c-orange")
  const decide = tone(p.decide, "decide")
  const alert = tone(p.alert, "alert")
  const k = Math.min(1.6, Math.max(1, spread(pole, bg) / Math.max(1, spread(ink, bg))))
  const veil = (a: number): string => alpha(ink, a * k)
  return {
    bg,
    "bg-2": bg2,
    "bg-3": bg3,
    ink,
    "ink-2": ink2,
    "ink-3": ink3,
    line: veil(level.line),
    "line-2": veil(level.line2),
    "line-3": veil(level.line3),
    wash: veil(level.wash),
    "wash-2": veil(level.wash2),
    scrim: own.scrim,
    link: accent,
    "on-ink": bg,
    accent,
    "accent-wash": alpha(accent, level.accent),
    live: tone(p.live, "live"),
    doing: tone(p.doing, "doing"),
    review: tone(p.review, "review"),
    decide,
    "decide-wash": alpha(decide, level.decide),
    alert,
    "alert-wash": alpha(alert, level.alert),
    "c-red": red,
    "c-orange": orange,
    "c-yellow": yellow,
    "c-green": green,
    "c-teal": teal,
    "c-blue": blue,
    "c-indigo": tone(mix(blue, violet, 0.35), "c-indigo"),
    "c-violet": violet,
    "c-pink": tone(mix(red, violet, 0.35), "c-pink"),
    "c-brown": tone(mix(orange, ink2, 0.4), "c-brown"),
  }
}
