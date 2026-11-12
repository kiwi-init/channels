const TOKEN = /(?<![\d-])(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z)|(?<![\d:])(\d{2}):(\d{2})(Z| UTC)(?![\dA-Za-z])/g
const FENCE = /^\s*(`{3,}|~{3,})/
const INLINE_CODE = /`+[^`]*`+/g
const DESTINATION = /\]\([^)]*\)/g
const BARE_URL = /https?:\/\/[^\s)]*/g
const ANY_TIME = /\d:\d\d/

const pad = (n: number): string => String(n).padStart(2, "0")

const utcDay = (year: number, month: number, day: number): Date | null => {
  const at = new Date(Date.UTC(year, month - 1, day))
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day ? at : null
}

const utcSecond = (day: Date, hour: number, minute: number, second: number): string | null => {
  if (hour > 23 || minute > 59 || second > 59) return null
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}T${pad(hour)}:${pad(minute)}:${pad(second)}Z`
}

function masked(markdown: string): [number, number][] {
  const spans: [number, number][] = []
  let fence = ""
  let at = 0
  for (const line of markdown.split("\n")) {
    const from = at
    at += line.length + 1
    const mark = FENCE.exec(line)?.[1]
    if (fence) {
      spans.push([from, at - 1])
      if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = ""
    } else if (mark) {
      fence = mark
      spans.push([from, at - 1])
    }
  }
  for (const found of [INLINE_CODE, DESTINATION, BARE_URL]) {
    for (const m of markdown.matchAll(found)) spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length])
    found.lastIndex = 0
  }
  return spans
}

export function zonedTimes(markdown: string, at?: number): string {
  if (!ANY_TIME.test(markdown)) return markdown
  const spans = masked(markdown)
  const hidden = (from: number, to: number): boolean => spans.some(([a, b]) => from < b && to > a)
  const day = at === undefined ? null : new Date(at)
  let out = ""
  let atPos = 0
  for (const m of markdown.matchAll(TOKEN)) {
    const whole = m[0]
    const from = m.index ?? 0
    let iso: string | null = null
    if (m[1] !== undefined) {
      const own = utcDay(Number(whole.slice(0, 4)), Number(whole.slice(5, 7)), Number(whole.slice(8, 10)))
      if (own) iso = utcSecond(own, Number(whole.slice(11, 13)), Number(whole.slice(14, 16)), whole.length > 17 ? Number(whole.slice(17, 19)) : 0)
    } else if (day) {
      iso = utcSecond(day, Number(m[2]), Number(m[3]), 0)
    }
    if (!iso || hidden(from, from + whole.length)) continue
    out += markdown.slice(atPos, from) + `[${whole}](kiwi-utc:${iso})`
    atPos = from + whole.length
  }
  TOKEN.lastIndex = 0
  return atPos === 0 ? markdown : out + markdown.slice(atPos)
}

export interface LocalTime {
  time: string
  zone: string
  date: string | null
}

export function localOf(iso: string, timeZone: string, locale: string): LocalTime {
  const at = new Date(iso)
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(at)
  const zone = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? ""
  const utcShown = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(at)
  const localShown = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone }).format(at)
  return { time, zone, date: localShown === utcShown ? null : localShown }
}

export function tooltipOf(iso: string, dateOnly: boolean, assuming: (date: string) => string, timeZone: string, locale: string): string {
  const local = localOf(iso, timeZone, locale)
  const parts = [`${local.time} ${local.zone}`]
  if (local.date) parts.push(local.date)
  if (dateOnly) parts.push(assuming(iso.slice(0, 10)))
  return parts.join(" · ")
}
