import { createContext } from "react"

export const MentionNames = createContext<((name: string) => string | undefined) | undefined>(undefined)

export interface Mentionable {
  name: string
  label: string
}

export interface MentionSpan {
  at: number
  end: number
  name: string
}

const BEFORE = /[\p{L}\p{N}\p{M}_/.@-]/u
const AFTER = /[\p{L}\p{N}\p{M}_@-]/u
const WORDY = /[\p{L}\p{N}]/u
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function standsAlone(p: Mentionable, people: readonly Mentionable[]): boolean {
  const label = p.label
  if (!label || label !== label.trim() || /[\n`@]/.test(label) || same(label, p.name)) return false
  return !people.some((o) => o.name !== p.name && same(o.label, label)) && !people.some((o) => same(o.name, label))
}

export function mentionText(p: Mentionable, people: readonly Mentionable[]): string {
  return standsAlone(p, people) ? p.label : p.name
}

function ends(body: string, end: number): boolean {
  const next = body[end]
  if (next === undefined) return true
  if (AFTER.test(next)) return false
  return !(next === "." && WORDY.test(body[end + 1] ?? ""))
}

export function composerMentions(body: string, people: readonly Mentionable[]): MentionSpan[] {
  if (!body.includes("@")) return []
  const candidates = people.flatMap((p) => [{ text: p.name, name: p.name }, ...(standsAlone(p, people) ? [{ text: p.label, name: p.name }] : [])]).sort((a, b) => b.text.length - a.text.length)
  const code = [...body.matchAll(CODE)].map((m) => [m.index, m.index + m[0].length] as const)
  const spans: MentionSpan[] = []
  for (let i = body.indexOf("@"); i !== -1; i = body.indexOf("@", i + 1)) {
    if (i > 0 && BEFORE.test(body[i - 1]!)) continue
    if (code.some(([from, to]) => i >= from && i < to)) continue
    const hit = candidates.find((c) => same(body.slice(i + 1, i + 1 + c.text.length), c.text) && ends(body, i + 1 + c.text.length))
    if (!hit) continue
    spans.push({ at: i, end: i + 1 + hit.text.length, name: hit.name })
    i += hit.text.length
  }
  return spans
}

export function withHandles(body: string, people: readonly Mentionable[]): string {
  let out = ""
  let from = 0
  for (const s of composerMentions(body, people)) {
    out += `${body.slice(from, s.at)}@${s.name}`
    from = s.end
  }
  return out + body.slice(from)
}
