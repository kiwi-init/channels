// Message text is untrusted. Only these schemes may become a link; everything else stays text.
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"])

/** A URL a message may open, or undefined when it must stay plain text. */
export function sanitizeMarkdownUrl(url: string): string | undefined {
  const value = url.trim()
  if (!value || hasControlOrSpace(value)) return undefined
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return undefined
  }
  if (!SAFE_PROTOCOLS.has(parsed.protocol)) return undefined
  if (parsed.username || parsed.password) return undefined
  if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.hostname) return undefined
  return value
}

const MESSAGE_REF = /(?<![\p{L}\p{N}\p{M}_/#&.-])#([1-9]\d{0,8})(?![\p{L}\p{N}\p{M}_])/gu

export type RefPart = { kind: "text"; text: string } | { kind: "ref"; text: string; seq: number }

export function messageRefs(text: string, known: (seq: number) => boolean): RefPart[] {
  const parts: RefPart[] = []
  let from = 0
  for (const match of text.matchAll(MESSAGE_REF)) {
    const seq = Number(match[1])
    if (!known(seq)) continue
    if (match.index > from) parts.push({ kind: "text", text: text.slice(from, match.index) })
    parts.push({ kind: "ref", text: match[0], seq })
    from = match.index + match[0].length
  }
  if (from < text.length || parts.length === 0) parts.push({ kind: "text", text: text.slice(from) })
  return parts
}

export function knownRefs(text: string, known: (seq: number) => boolean): string {
  const seqs: number[] = []
  for (const match of text.matchAll(MESSAGE_REF)) {
    const seq = Number(match[1])
    if (known(seq)) seqs.push(seq)
  }
  return seqs.join(",")
}

const MENTION = /(?<![\p{L}\p{N}\p{M}_/.@-])@([\p{L}\p{N}_.-]+)/gu

export type MentionPart = { kind: "text"; text: string } | { kind: "mention"; text: string; name: string; label: string }

function mentioned(raw: string, labelOf: (name: string) => string | undefined): { name: string; label: string } | null {
  for (let name = raw; name; name = name.slice(0, -1)) {
    const label = labelOf(name)
    if (label !== undefined) return { name, label }
    if (!/[._-]$/.test(name)) return null
  }
  return null
}

export function mentionParts(text: string, labelOf: (name: string) => string | undefined): MentionPart[] {
  const parts: MentionPart[] = []
  let from = 0
  for (const match of text.matchAll(MENTION)) {
    const who = mentioned(match[1]!, labelOf)
    if (!who) continue
    if (match.index > from) parts.push({ kind: "text", text: text.slice(from, match.index) })
    parts.push({ kind: "mention", text: `@${who.name}`, ...who })
    from = match.index + 1 + who.name.length
  }
  if (from < text.length || parts.length === 0) parts.push({ kind: "text", text: text.slice(from) })
  return parts
}

export class Recent<V> {
  private readonly items = new Map<string, V>()
  constructor(private readonly max: number) {}
  get(key: string): V | undefined {
    const v = this.items.get(key)
    if (v === undefined) return undefined
    this.items.delete(key)
    this.items.set(key, v)
    return v
  }
  set(key: string, v: V): void {
    this.items.delete(key)
    this.items.set(key, v)
    if (this.items.size > this.max) this.items.delete(this.items.keys().next().value!)
  }
}

export type SortDir = "asc" | "desc"

/** None, then ascending, then descending, then back to the author's order. */
export function nextSort(current: { column: number; direction: SortDir } | null, column: number): { column: number; direction: SortDir } | null {
  if (!current || current.column !== column) return { column, direction: "asc" }
  if (current.direction === "asc") return { column, direction: "desc" }
  return null
}

/** Numbers compare as numbers. Everything else compares as text, so "10" sorts after "2". */
export function compareCells(a: string, b: string): number {
  const an = numeric(a)
  const bn = numeric(b)
  if (an !== null && bn !== null && an !== bn) return an < bn ? -1 : 1
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
}

function hasControlOrSpace(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x20 || code === 0x7f) return true
  }
  return false
}

function numeric(value: string): number | null {
  const text = value.trim().replace(/,/g, "")
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(text)) return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}
