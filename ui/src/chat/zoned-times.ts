const TOKEN = /(?<![\d-])(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z)|(?<![\d:])(\d{2}):(\d{2})(Z| UTC)(?![\dA-Za-z])/g
const FENCE = /^\s{0,3}(?:>\s?)*(?:`{3,}|~{3,})/
const LINK = /\[[^\]]*\]\([^)]*\)/g
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

const codeSpans = (markdown: string): [number, number][] => {
  const spans: [number, number][] = []
  const runs = [...markdown.matchAll(/`+/g)]
  for (let i = 0; i < runs.length; i++) {
    const open = runs[i]!
    let close: typeof open | undefined
    for (let j = i + 1; j < runs.length && !close; j++) if (runs[j]![0].length === open[0].length) close = runs[j]
    if (!close) continue
    spans.push([open.index ?? 0, (close.index ?? 0) + close[0].length])
    i = runs.indexOf(close)
  }
  return spans
}

function masked(markdown: string): [number, number][] {
  const spans: [number, number][] = []
  let fence = ""
  let at = 0
  for (const line of markdown.split("\n")) {
    const from = at
    at += line.length + 1
    const mark = FENCE.test(line) ? line.trim().replace(/^>\s*/, "")[0] : ""
    if (fence) {
      spans.push([from, at - 1])
      if (mark && mark === fence) fence = ""
    } else if (mark) {
      fence = mark
      spans.push([from, at - 1])
    }
    FENCE.lastIndex = 0
  }
  for (const found of [LINK, BARE_URL]) {
    for (const m of markdown.matchAll(found)) spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length])
    found.lastIndex = 0
  }
  return spans.concat(codeSpans(markdown))
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

export function localOf(iso: string, timeZone: string, locale: string): LocalTime | null {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(at)
  const zone = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? ""
  const utcShown = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(at)
  const localShown = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone }).format(at)
  return { time, zone, date: localShown === utcShown ? null : localShown }
}

export function tooltipOf(iso: string, dateOnly: boolean, assuming: (date: string) => string, timeZone: string, locale: string): string | null {
  const local = localOf(iso, timeZone, locale)
  if (!local) return null
  const parts = [`${local.time} ${local.zone}`]
  if (local.date) parts.push(local.date)
  if (dateOnly) parts.push(assuming(iso.slice(0, 10)))
  return parts.join(" · ")
}
