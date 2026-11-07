const WARM_SECONDS = 0.5
const SAMPLE_SECONDS = 1.5
const EARLY_SECONDS = 0.5
const EARLY_FRAMES = 8
const SLOWEST_FRAME = 1 / 24
const HOPELESS_FRAME = 1 / 12
export const SLOW_HOLD_MS = 10 * 60_000

export interface Pace {
  watched: number
  time: number
  frames: number[]
}

export type Verdict = "measuring" | "fast" | "slow"

export const freshPace = (): Pace => ({ watched: 0, time: 0, frames: [] })

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2
}

export function paced(p: Pace, raw: number): Verdict {
  p.watched += raw
  if (p.watched < WARM_SECONDS) return "measuring"
  if (p.time >= SAMPLE_SECONDS) return "fast"
  p.frames.push(raw)
  p.time += raw
  const typical = median(p.frames)
  if (p.time >= EARLY_SECONDS && p.frames.length >= EARLY_FRAMES && typical > HOPELESS_FRAME) return "slow"
  if (p.time < SAMPLE_SECONDS) return "measuring"
  return typical > SLOWEST_FRAME ? "slow" : "fast"
}
