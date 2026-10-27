import { bareAt, memberNamed, readsAsHandle } from "@kiwi/core/state.ts"
import { fromMarkdown } from "mdast-util-from-markdown"
import { gfmFromMarkdown } from "mdast-util-gfm"
import { gfm } from "micromark-extension-gfm"

type MdNode = { type: string; value?: string; children?: MdNode[]; position?: { start: { offset?: number }; end: { offset?: number } } }

type Found = { start: number; end: number } & ({ kind: "mention" | "bare"; name: string; label: string } | { kind: "task"; id: number })

const NOT_PROSE = new Set(["link", "linkReference", "definition", "image", "imageReference", "code", "inlineCode", "html"])
const MENTION = /(?<![\p{L}\p{N}_.@-])@([\p{L}\p{N}_.-]+)/gu
const TASK = /\bT(\d+)\b/g
const WORD = /(?<![\p{L}\p{N}\p{M}_/.@-])[\p{L}\p{N}_.-]+/gu

type Span = { start: number; end: number }

function prose(node: MdNode): Span[] {
  if (NOT_PROSE.has(node.type)) return []
  if (node.type === "text") {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    return start !== undefined && end !== undefined ? [{ start, end }] : []
  }
  return (node.children ?? []).flatMap(prose)
}

const parsed = new Map<string, Span[]>()

function spansOf(text: string): Span[] {
  const known = parsed.get(text)
  if (known) return known
  const spans = prose(fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }))
  if (parsed.size >= 500) parsed.delete(parsed.keys().next().value ?? "")
  parsed.set(text, spans)
  return spans
}

function found(text: string, nicknames: ReadonlyMap<string, string>): Found[] {
  const labelOf = (name: string) => nicknames.get(name) ?? nicknames.get(name.toLowerCase())
  const hits: Found[] = []
  for (const span of spansOf(text)) {
    const part = text.slice(span.start, span.end)
    for (const m of part.matchAll(MENTION)) {
      const who = memberNamed(m[1] ?? "", labelOf)
      if (who) hits.push({ kind: "mention", ...who, start: span.start + m.index, end: span.start + m.index + 1 + who.name.length })
    }
    for (const m of part.matchAll(TASK)) hits.push({ kind: "task", id: Number(m[1]), start: span.start + m.index, end: span.start + m.index + m[0].length })
    for (const m of part.matchAll(WORD)) {
      const who = memberNamed(m[0], labelOf)
      const start = span.start + m.index
      if (who && readsAsHandle(who.name, who.label) && bareAt(text, start, start + who.name.length)) hits.push({ kind: "bare", ...who, start, end: start + who.name.length })
    }
  }
  const kept: Found[] = []
  for (const hit of hits.sort((a, b) => a.start - b.start)) if (!kept.length || hit.start >= (kept.at(-1)?.end ?? 0)) kept.push(hit)
  return kept
}

function swap(text: string, nicknames: ReadonlyMap<string, string>, out: (hit: Found) => string | null): string {
  let result = ""
  let from = 0
  for (const hit of found(text, nicknames)) {
    const said = out(hit)
    if (said === null) continue
    result += text.slice(from, hit.start) + said
    from = hit.end
  }
  return result + text.slice(from)
}

const literal = (text: string): string => text.replace(/[\\`*_[\]()<>&!|~]/g, "\\$&")

export function linked(text: string, nicknames: ReadonlyMap<string, string>, tasks: ReadonlySet<number>): string {
  return swap(text, nicknames, (hit) =>
    hit.kind === "task" ? (tasks.has(hit.id) ? `[T${hit.id}](kiwi-task:${hit.id})` : null) : `[${hit.kind === "mention" ? "@" : ""}${literal(hit.label)}](kiwi-mention:${hit.name})`
  )
}

export function named(text: string, nicknames: ReadonlyMap<string, string>): string {
  return swap(text, nicknames, (hit) => (hit.kind === "task" ? null : `${hit.kind === "mention" ? "@" : ""}${hit.label}`))
}

export function withNames(text: string, nicknames: ReadonlyMap<string, string>, plain: (text: string) => string): string {
  const labels: string[] = []
  const marked = swap(text, nicknames, (hit) => {
    if (hit.kind === "task") return null
    labels.push(`${hit.kind === "mention" ? "@" : ""}${hit.label}`)
    return `${labels.length - 1}`
  })
  return plain(marked).replace(/(\d+)/g, (whole: string, i: string) => labels[Number(i)] ?? whole)
}
