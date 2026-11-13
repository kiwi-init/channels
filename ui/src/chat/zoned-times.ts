import type { ASTNode } from "react-native-enriched-markdown/lib/typescript/src/web/types"

const TOKEN = /(?<![\d-])(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z)|(?<![\d:])(\d{2}):(\d{2})(Z| UTC)(?![\dA-Za-z])/g
const BARE_URL = /https?:\/\/\S+/g
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

export type Segment = string | { token: string; iso: string }

function proseTimes(text: string, at?: number): Segment[] | null {
  if (!ANY_TIME.test(text)) return null
  const day = at === undefined ? null : new Date(at)
  const out: Segment[] = []
  let atPos = 0
  for (const m of text.matchAll(TOKEN)) {
    const whole = m[0]
    const from = m.index ?? 0
    let iso: string | null = null
    if (m[1] !== undefined) {
      const own = utcDay(Number(whole.slice(0, 4)), Number(whole.slice(5, 7)), Number(whole.slice(8, 10)))
      if (own) iso = utcSecond(own, Number(whole.slice(11, 13)), Number(whole.slice(14, 16)), whole.length > 17 ? Number(whole.slice(17, 19)) : 0)
    } else if (day) {
      iso = utcSecond(day, Number(m[2]), Number(m[3]), 0)
    }
    if (!iso) continue
    out.push(text.slice(atPos, from), { token: whole, iso })
    atPos = from + whole.length
  }
  TOKEN.lastIndex = 0
  return atPos === 0 ? null : out.concat(text.slice(atPos))
}

export function segments(text: string, at?: number): Segment[] | null {
  if (!ANY_TIME.test(text)) return null
  const parts: Segment[] = []
  let found = false
  let atPos = 0
  for (const url of text.matchAll(BARE_URL)) {
    const from = url.index ?? 0
    const before = proseTimes(text.slice(atPos, from), at)
    if (before) found = true
    parts.push(...(before ?? [text.slice(atPos, from)]), url[0])
    atPos = from + url[0].length
  }
  BARE_URL.lastIndex = 0
  const rest = proseTimes(text.slice(atPos), at)
  if (rest) found = true
  if (!found) return null
  parts.push(...(rest ?? [text.slice(atPos)]))
  return parts
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

export function zonedLinks(node: ASTNode, at?: number, blocked = false): void {
  const skip = blocked || node.type === "Link" || node.type === "Code" || node.type === "CodeBlock"
  if (!skip && node.children?.length) {
    const out: ASTNode[] = []
    let grew = false
    for (const child of node.children) {
      const found = child.type === "Text" && child.content !== undefined ? segments(child.content, at) : null
      if (found) {
        grew = true
        for (const seg of found)
          out.push(typeof seg === "string" ? { type: "Text", content: seg } : { type: "Link", attributes: { url: `kiwi-utc:${seg.iso}` }, children: [{ type: "Text", content: seg.token }] })
      } else out.push(child)
    }
    if (grew) node.children = out
  }
  for (const child of node.children ?? []) zonedLinks(child, at, skip)
}
