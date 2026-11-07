export const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
export const ADVANCE = 0.33

const PAD = 64
const FORM = 0.9
const FADE_IN = 0.45
const LEAVE = 1.9
const CROSS = 0.06
const FOCUS_AT = 0.9
const FOCUS = 0.7

export type Rand = () => number
export type Source = "air" | "bloom"
type Vec = [number, number, number]

export interface Glyph {
  slot: Vec
  from: Vec
  away: Vec
  born: number
  leave: number
  flips: number[]
  chars: number[]
  rot: number
  tint: number
  scale: number
  ink: number
}

export interface Run {
  glyphs: Glyph[]
  blurAt: number
  end: number
}

export interface Pose {
  x: number
  y: number
  z: number
  a: number
  b: number
  mix: number
  form: number
  alpha: number
}

const READABLE = /[a-z]{3}|[A-Z]{3}|[A-Z][a-z]{2}|[A-Za-z]{4}/

export const readable = (s: string): boolean => READABLE.test(s)

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))
const ease = (x: number): number => {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}
const easeOut = (x: number): number => 1 - Math.pow(1 - clamp01(x), 3)
const pick = (r: Rand, n: number): number => Math.min(n - 1, Math.floor(r() * n))

export const runGap = (r: Rand): number => 8 + 12 * r()

export function cipherText(r: Rand, n: number): string {
  const pad = r() < 0.3 ? (r() < 0.5 ? 1 : 2) : 0
  let s = ""
  while (s.length < n - pad) {
    const c = BASE64[pick(r, PAD)] ?? "A"
    if (!readable(s.slice(-3) + c)) s += c
  }
  return s + "=".repeat(pad)
}

export function planRun(r: Rand, source: Source, length?: number): Run {
  const n = length ?? 8 + Math.floor(Math.pow(r(), 1.2) * 9)
  const text = cipherText(r, n)
  const tilt = (r() - 0.5) * 0.16
  const arc = (r() - 0.5) * 1.4
  const skew = (r() - 0.5) * 0.7
  const hold = 1.4 + r() * 0.6
  const formed = 0.75 + FORM
  const glyphs: Glyph[] = []
  for (let i = 0; i < n; i++) {
    const u = n > 1 ? i / (n - 1) : 0.5
    const x = (i - (n - 1) / 2) * ADVANCE + (r() - 0.5) * 0.06
    const slot: Vec = [x, x * tilt + arc * (u * 2 - 1) * (u * 2 - 1) + (r() - 0.5) * 0.14, x * skew]
    const from: Vec = source === "air" ? [x - 3 - r() * 5, slot[1] + (r() - 0.5) * 3, slot[2] + (r() - 0.5) * 4] : [x + (r() - 0.5) * 2, slot[1] - 3 - r() * 4, slot[2] + (r() - 0.5) * 2]
    const away: Vec = [3 + r() * 6, (r() - 0.3) * 4, (r() - 0.5) * 3]
    const born = u * 0.5 + r() * 0.25
    const leave = formed + hold + u * 0.5 + r() * 0.2
    const turns = 3 + pick(r, 4)
    const growth = 1.3 + r() * 0.25
    let step = 0.085 + r() * 0.03
    let at = Math.max(born + 0.3, 1.45) + u * 0.15 + r() * 0.15
    const flips: number[] = []
    for (let k = 0; k < turns; k++) {
      flips.push(at)
      at += step
      step *= growth
    }
    const last = flips[flips.length - 1] ?? born
    const latest = formed + hold - 0.7
    if (last > latest) {
      const first = flips[0] ?? born
      const squeeze = (latest - first) / Math.max(1e-3, last - first)
      for (let k = 0; k < flips.length; k++) flips[k] = first + ((flips[k] ?? first) - first) * squeeze
    }
    const final = BASE64.indexOf(text[i] ?? "A")
    const chars: number[] = []
    for (let k = 0; k < turns; k++) {
      let c = pick(r, PAD)
      while (c === final || c === chars[k - 1]) c = pick(r, PAD)
      chars.push(c)
    }
    chars.push(final)
    glyphs.push({ slot, from, away, born, leave, flips, chars, rot: (r() - 0.5) * 0.2, tint: r(), scale: 0.92 + r() * 0.16, ink: 0.65 + r() * 0.35 })
  }
  const leaves = glyphs.map((g) => g.leave)
  return { glyphs, blurAt: Math.min(...leaves) - 0.55, end: Math.max(...leaves) + LEAVE }
}

export const runFocus = (run: Run, t: number): number => ease((t - FOCUS_AT) / FOCUS) * (1 - ease((t - run.blurAt) / FOCUS))

export function poseGlyph(g: Glyph, t: number, out: Pose): Pose {
  const move = easeOut((t - g.born) / FORM)
  const gone = clamp01((t - g.leave) / LEAVE)
  const drift = Math.pow(gone, 1.6)
  out.x = g.from[0] + (g.slot[0] - g.from[0]) * move + g.away[0] * drift
  out.y = g.from[1] + (g.slot[1] - g.from[1]) * move + g.away[1] * drift
  out.z = g.from[2] + (g.slot[2] - g.from[2]) * move + g.away[2] * drift
  out.form = ease((t - g.born - 0.25) / (FORM - 0.25)) * (1 - ease(gone / 0.4))
  out.alpha = ease((t - g.born) / FADE_IN) * (1 - ease(gone))
  let k = 0
  while (k < g.flips.length && (g.flips[k] ?? Infinity) <= t) k++
  out.b = g.chars[k] ?? 0
  out.a = g.chars[Math.max(0, k - 1)] ?? out.b
  out.mix = k === 0 ? 1 : clamp01((t - (g.flips[k - 1] ?? 0)) / CROSS)
  return out
}
