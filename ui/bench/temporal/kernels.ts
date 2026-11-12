import type { Intl as PolyIntl, Temporal as TemporalNS } from "temporal-polyfill"

type T = typeof TemporalNS
type DTF = typeof PolyIntl.DateTimeFormat

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const QUEUE_MS = 24 * 60 * 60_000
const UNREAD_MS = 5 * 60_000

const WORDS = { now: "now", today: "Today", yesterday: "Yesterday" }

const formats = new Map<string, Intl.NumberFormat>()
function numberFormat(lang: string, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${lang}:${JSON.stringify(options)}`
  let f = formats.get(key)
  if (!f) formats.set(key, (f = new Intl.NumberFormat(lang, options)))
  return f
}
const span = (lang: string, n: number, unit: "minute" | "hour" | "day"): string => numberFormat(lang, { style: "unit", unit, unitDisplay: "narrow" }).format(n)

export interface UiKernels {
  clock: (lang: string, at: number) => string
  ago: (lang: string, at: number, now: number) => string
  day: (lang: string, at: number, now: number) => string
  sameDay: (a: number, b: number) => string
}

export function dateUi(): UiKernels {
  let clocks: { lang: string; format: Intl.DateTimeFormat } | null = null
  return {
    clock(lang, at) {
      if (clocks?.lang !== lang) clocks = { lang, format: new Intl.DateTimeFormat([lang], { hour: "2-digit", minute: "2-digit" }) }
      return Number.isFinite(at) ? clocks.format.format(at) : new Date(at).toLocaleTimeString([lang], { hour: "2-digit", minute: "2-digit" })
    },
    ago(lang, at, now) {
      const d = Math.max(0, now - at)
      if (d < MIN) return WORDS.now
      if (d < HOUR) return span(lang, Math.floor(d / MIN), "minute")
      if (d < DAY) return span(lang, Math.floor(d / HOUR), "hour")
      if (d < WEEK) return span(lang, Math.floor(d / DAY), "day")
      return new Date(at).toLocaleDateString([lang], { month: "short", day: "numeric" })
    },
    day(lang, at, now) {
      const start = new Date(now)
      start.setHours(0, 0, 0, 0)
      if (at >= start.getTime()) return WORDS.today
      if (at >= start.getTime() - DAY) return WORDS.yesterday
      return new Date(at).toLocaleDateString([lang], { weekday: "long", month: "short", day: "numeric" })
    },
    sameDay: (a, b) => String(new Date(a).toDateString() === new Date(b).toDateString()),
  }
}

export function temporalUi(Temporal: T, DateTimeFormat: DTF): UiKernels {
  const tz = Temporal.Now.timeZoneId()
  const inst = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms)
  const dateOf = (ms: number) => inst(ms).toZonedDateTimeISO(tz).toPlainDate()
  const D = { min: Temporal.Duration.from({ minutes: 1 }), hour: Temporal.Duration.from({ hours: 1 }), day: Temporal.Duration.from({ hours: 24 }), week: Temporal.Duration.from({ hours: 168 }) }
  let clocks: { lang: string; format: InstanceType<DTF> } | null = null
  return {
    clock(lang, at) {
      if (clocks?.lang !== lang) clocks = { lang, format: new DateTimeFormat([lang], { hour: "2-digit", minute: "2-digit" }) }
      return clocks.format.format(inst(at))
    },
    ago(lang, at, now) {
      const a = inst(at)
      const d = inst(now).since(a)
      if (d.sign <= 0 || Temporal.Duration.compare(d, D.min) < 0) return WORDS.now
      if (Temporal.Duration.compare(d, D.hour) < 0) return span(lang, Math.floor(d.total("minutes")), "minute")
      if (Temporal.Duration.compare(d, D.day) < 0) return span(lang, Math.floor(d.total("hours")), "hour")
      if (Temporal.Duration.compare(d, D.week) < 0) return span(lang, Math.floor(d.total("hours") / 24), "day")
      return a.toLocaleString([lang], { month: "short", day: "numeric" })
    },
    day(lang, at, now) {
      const today = dateOf(now)
      const d = dateOf(at)
      if (Temporal.PlainDate.compare(d, today) >= 0) return WORDS.today
      if (d.equals(today.subtract({ days: 1 }))) return WORDS.yesterday
      return inst(at).toLocaleString([lang], { weekday: "long", month: "short", day: "numeric" })
    },
    sameDay: (a, b) => String(dateOf(a).equals(dateOf(b))),
  }
}

export interface ClockCase {
  now: number
  at: number
  wokeAt: number | null
  wokeRead: boolean
  every: number
  qAt: number
  qDay: number
}

export type DaemonKernel = (c: ClockCase) => string

export const dateDaemon: DaemonKernel = (c) => {
  const quiet = Math.max(0, c.now - c.at)
  const ladder = quiet >= 3 * c.every ? 3 : quiet >= 2 * c.every ? 2 : quiet >= c.every ? 1 : 0
  const unread = c.wokeAt !== null && (c.wokeRead || c.now - c.wokeAt < UNREAD_MS)
  const skip = quiet >= c.every && quiet < 2 * c.every && !unread
  const day = Math.floor((c.now - c.qAt) / QUEUE_MS)
  const queue = day >= 1 && day > c.qDay
  return `${quiet}|${ladder}|${skip}|${day}|${queue}`
}

export function temporalDaemon(Temporal: T): DaemonKernel {
  const zero = new Temporal.Duration()
  const unreadD = Temporal.Duration.from({ milliseconds: UNREAD_MS })
  const queueD = Temporal.Duration.from({ hours: 24 })
  const everyCache = new Map<number, TemporalNS.Duration[]>()
  const everyOf = (ms: number) => {
    let e = everyCache.get(ms)
    if (!e) everyCache.set(ms, (e = [1, 2, 3].map((k) => Temporal.Duration.from({ milliseconds: k * ms }).round({ largestUnit: "hours" }))))
    return e
  }
  const cmp = Temporal.Duration.compare
  return (c) => {
    const now = Temporal.Instant.fromEpochMilliseconds(c.now)
    const since = now.since(Temporal.Instant.fromEpochMilliseconds(c.at), { largestUnit: "hours" })
    const quiet = since.sign < 0 ? zero : since
    const [e1, e2, e3] = everyOf(c.every) as [TemporalNS.Duration, TemporalNS.Duration, TemporalNS.Duration]
    const ladder = cmp(quiet, e3) >= 0 ? 3 : cmp(quiet, e2) >= 0 ? 2 : cmp(quiet, e1) >= 0 ? 1 : 0
    const unread = c.wokeAt !== null && (c.wokeRead || cmp(now.since(Temporal.Instant.fromEpochMilliseconds(c.wokeAt)), unreadD) < 0)
    const skip = cmp(quiet, e1) >= 0 && cmp(quiet, e2) < 0 && !unread
    const waited = now.since(Temporal.Instant.fromEpochMilliseconds(c.qAt), { largestUnit: "hours" })
    const day = Math.floor(waited.total("hours") / 24)
    const queue = cmp(waited, queueD) >= 0 && day > c.qDay
    return `${quiet.total("milliseconds")}|${ladder}|${skip}|${day}|${queue}`
  }
}
