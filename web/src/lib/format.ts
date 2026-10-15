import type { Member } from "@mc/state.ts"

/** One or two letters for a monogram: "Jonatas Filho" → "JF", "claude" → "C". */
export function initials(name: string): string {
  // "Alice (dev)" is "A", not "A(": a note in parentheses isn't part of the name.
  const parts = name
    .replace(/\([^)]*\)/g, " ")
    .split(/[\s._-]+/)
    .filter(Boolean)
  if (!parts.length) return name.slice(0, 1).toUpperCase()
  return (parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : parts[0]!.slice(0, 1)).toUpperCase()
}

export function memberName(m: Pick<Member, "name" | "kind" | "display"> | undefined, fallback = ""): string {
  if (!m) return fallback
  return m.display || m.name
}

/** Who a member is, in a phrase: "Owner", "Reviewer for Jonatas Filho", "Agent for Jonatas Walker". */
export function memberLine(m: Pick<Member, "name" | "kind" | "display" | "sponsor" | "role" | "owner">): string {
  if (m.owner) return "Owner"
  if (m.kind === "human") return "Person"
  const role = m.role ? m.role[0]!.toUpperCase() + m.role.slice(1) : "Agent"
  return m.sponsor ? `${role} for ${m.sponsor.name}` : role
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "medium" })
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long" })
const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "numeric", year: "2-digit" })

export const formatTime = (ts: number) => timeFmt.format(ts)
export const formatFull = (ts: number) => fullFmt.format(ts)

/** Like the Messages list: a time today, "Yesterday", a weekday this week, else a date. */
export function formatShort(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const today = new Date(now)
  if (d.toDateString() === today.toDateString()) return formatTime(ts)
  if (d.toDateString() === new Date(now - 86_400_000).toDateString()) return "Yesterday"
  if (now - ts < 6 * 86_400_000) return weekdayFmt.format(d)
  return dateFmt.format(d)
}

const stampWeekday = new Intl.DateTimeFormat(undefined, { weekday: "long" })
const stampDate = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" })
const stampYear = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" })

/** The stamp between messages, as Messages words it: "Today at 14:08", "Sunday at 16:49", "Sun, 18 Jan at 16:49". */
export function formatStamp(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const today = new Date(now)
  const at = formatTime(ts)
  if (d.toDateString() === today.toDateString()) return `Today at ${at}`
  if (d.toDateString() === new Date(now - 86_400_000).toDateString()) return `Yesterday at ${at}`
  if (now - ts < 6 * 86_400_000) return `${stampWeekday.format(d)} at ${at}`
  if (d.getFullYear() === today.getFullYear()) return `${stampDate.format(d)} at ${at}`
  return `${stampYear.format(d)} at ${at}`
}

export function formatAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** Past this, a short title gives up its tail after a colon for the head before it. */
const SHORT_TITLE = 48

/**
 * A task's title as a list row says it: its first clause. Titles are often whole specs ("Seat on first
 * approval (owner's pick on #1340): a linked computer gets…"), so this stops at the first aside,
 * sentence end, semicolon or dash, and a long one keeps a several-word head before its colon.
 */
export function shortTitle(title: string): string {
  let s = title.split("\n")[0]!.trim()
  for (const cut of [/ \(/, /[.!?](?=\s)/, /;/, / [—–-] /]) {
    const i = s.search(cut)
    if (i > 0) s = s.slice(0, i)
  }
  s = s.replace(/[.!?:,\s]+$/, "")
  const colon = s.indexOf(": ")
  if (s.length > SHORT_TITLE && colon > 0 && s.slice(0, colon).split(" ").length >= 2) s = s.slice(0, colon)
  return s || title.trim()
}

/** One-line plain-text preview of a markdown body. */
export function excerpt(body: string, max = 90): string {
  const flat = body
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|~~)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#+|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat
}
