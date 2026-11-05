export type Rgb = readonly [number, number, number]

export interface Look {
  top: Rgb
  low: Rgb
  haze: Rgb
  light: Rgb
  cloud: Rgb
  glow: Rgb
}

export interface Body {
  x: number
  y: number
  show: number
}

export interface Daylight {
  look: Look
  sun: Body
  moon: Body & { phase: number }
  stars: number
  night: number
}

const SYNODIC_DAYS = 29.530588853
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14)
const DAY_MS = 86_400_000

const hex = (n: number): Rgb => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
const rgb = (r: number, g: number, b: number): Rgb => [r, g, b]

const NIGHT: Look = { top: hex(0x070d24), low: hex(0x18244a), haze: hex(0x223056), light: rgb(0.34, 0.4, 0.58), cloud: hex(0x27315a), glow: hex(0x3a4a7a) }
const DAWN: Look = { top: hex(0x2c3b78), low: hex(0xc58aa2), haze: hex(0xd8a6ac), light: rgb(0.74, 0.68, 0.8), cloud: hex(0xe2a2ae), glow: hex(0xf3a58f) }
const DUSK: Look = { top: hex(0x272a66), low: hex(0xd07c8c), haze: hex(0xc78c99), light: rgb(0.76, 0.62, 0.72), cloud: hex(0xdf8a8e), glow: hex(0xf28a6a) }
const SUNRISE: Look = { top: hex(0x6a8cc4), low: hex(0xf5c7a3), haze: hex(0xf5dac4), light: rgb(1.0, 0.92, 0.84), cloud: hex(0xfbd0b5), glow: hex(0xffc58a) }
const SUNSET: Look = { top: hex(0x5a74b6), low: hex(0xf6ad7b), haze: hex(0xf2c69e), light: rgb(1.03, 0.86, 0.7), cloud: hex(0xf8b68d), glow: hex(0xffa860) }
const DAY: Look = { top: hex(0x6e9ccb), low: hex(0xb7cde2), haze: hex(0xe8e4dc), light: rgb(1, 1, 1), cloud: hex(0xfbeee2), glow: hex(0xfff1d6) }

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const mixLook = (a: Look, b: Look, t: number): Look => ({
  top: mixRgb(a.top, b.top, t),
  low: mixRgb(a.low, b.low, t),
  haze: mixRgb(a.haze, b.haze, t),
  light: mixRgb(a.light, b.light, t),
  cloud: mixRgb(a.cloud, b.cloud, t),
  glow: mixRgb(a.glow, b.glow, t),
})

function lookAt(sunY: number, morning: boolean): Look {
  const keys: [number, Look][] = [
    [-0.32, NIGHT],
    [-0.08, morning ? DAWN : DUSK],
    [0.12, morning ? SUNRISE : SUNSET],
    [0.45, DAY],
  ]
  const first = keys[0] as [number, Look]
  if (sunY <= first[0]) return first[1]
  for (let i = 1; i < keys.length; i++) {
    const [y1, l1] = keys[i] as [number, Look]
    const [y0, l0] = keys[i - 1] as [number, Look]
    if (sunY <= y1) return mixLook(l0, l1, smoothstep(0, 1, (sunY - y0) / (y1 - y0)))
  }
  return DAY
}

export function moonPhase(at: Date): number {
  const days = (at.getTime() - NEW_MOON) / DAY_MS
  return (((days / SYNODIC_DAYS) % 1) + 1) % 1
}

export function daylight(at: Date): Daylight {
  const hour = at.getHours() + at.getMinutes() / 60 + at.getSeconds() / 3600
  const sunT = (hour - 6) / 12
  const sunY = Math.sin(Math.PI * sunT)
  const phase = moonPhase(at)
  const moonT = ((((hour - 6 - phase * 24) % 24) + 24) % 24) / 12
  const moonY = Math.sin(Math.PI * moonT)
  const day = smoothstep(-0.05, 0.3, sunY)
  return {
    look: lookAt(sunY, hour < 12),
    sun: { x: sunT * 2 - 1, y: sunY, show: smoothstep(-0.18, 0.02, sunY) },
    moon: { x: moonT * 2 - 1, y: moonY, show: smoothstep(-0.12, 0.04, moonY) * (1 - 0.7 * day), phase },
    stars: smoothstep(-0.1, -0.38, sunY),
    night: smoothstep(0.05, -0.3, sunY),
  }
}
