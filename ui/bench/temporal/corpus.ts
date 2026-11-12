import { writeFileSync } from "node:fs"
import { join } from "node:path"

export const ZONES = ["America/New_York", "Europe/Berlin", "Australia/Sydney", "America/Sao_Paulo", "Asia/Kolkata", "UTC"] as const
export { LANGS } from "./langs.ts"

const MS = 1
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

let seed = 7748
const rand = (): number => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
  return seed / 2_147_483_648
}

function anchorsOf(zone: string): number[] {
  const out: number[] = []
  const from = Temporal.ZonedDateTime.from({ year: 2025, month: 1, day: 1, timeZone: zone })
  let t: Temporal.ZonedDateTime | null = from
  for (let i = 0; i < 4 && t; i++) {
    t = t.getTimeZoneTransition("next")
    if (!t || t.year > 2026) break
    out.push(t.epochMilliseconds, t.startOfDay().epochMilliseconds, t.add({ days: 1 }).startOfDay().epochMilliseconds)
  }
  for (const d of ["2025-12-31", "2026-01-01", "2026-02-28", "2026-03-01"]) out.push(Temporal.PlainDate.from(d).toZonedDateTime(zone).epochMilliseconds)
  return out
}

const OFFSETS = [0, MS, -MS, MIN, -MIN, 30 * MIN, -30 * MIN, HOUR, -HOUR, 23 * HOUR, -23 * HOUR, DAY, -DAY, 25 * HOUR, -25 * HOUR, 47 * HOUR, 49 * HOUR]

export interface Pair {
  at: number
  now: number
}

export function buildCorpus(): { pairs: Pair[]; clockCases: import("./kernels.ts").ClockCase[] } {
  const keys = new Set<string>()
  const pairs: Pair[] = []
  const add = (at: number, now: number) => {
    const k = `${at}:${now}`
    if (keys.has(k) || now < at) return
    keys.add(k)
    pairs.push({ at, now })
  }
  for (const zone of ZONES)
    for (const a of anchorsOf(zone))
      for (const x of OFFSETS) for (const y of OFFSETS) if (x <= 0 && y >= 0 && (x !== 0 || y !== 0) && rand() < 0.35) add(a + x, a + y)
  const base = Date.UTC(2025, 0, 1)
  for (let i = 0; i < 600; i++) {
    const now = base + Math.floor(rand() * 2 * 365 * DAY)
    const gap = Math.floor(Math.exp(rand() * Math.log(400 * DAY)))
    add(now - gap, now)
  }
  const EVERY = [5, 10, 30, 60, 240].map((m) => m * MIN)
  const clockCases = []
  for (let i = 0; i < 4000; i++) {
    const every = EVERY[i % EVERY.length]!
    const now = base + Math.floor(rand() * 365 * DAY)
    const edge = i % 4 === 0
    const quiet = edge ? Math.floor(rand() * 4) * every + [0, -1, 1][i % 3]! : Math.floor(rand() * 4 * every)
    const qGap = edge ? Math.floor(rand() * 4) * DAY + [0, -1, 1][i % 3]! : Math.floor(rand() * 5 * DAY)
    const woke = rand()
    clockCases.push({ now, at: now - quiet, wokeAt: woke < 0.3 ? null : now - Math.floor(rand() * 10 * MIN), wokeRead: woke > 0.8, every, qAt: now - qGap, qDay: Math.floor(rand() * 3) })
  }
  return { pairs, clockCases }
}

if (import.meta.main) {
  const corpus = buildCorpus()
  writeFileSync(join(import.meta.dir, "corpus.json"), JSON.stringify(corpus))
  console.log(`pairs=${corpus.pairs.length} clockCases=${corpus.clockCases.length}`)
}
