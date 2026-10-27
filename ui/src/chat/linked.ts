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

function prose(node: MdNode, text: string): { start: number; end: number }[] {
  if (NOT_PROSE.has(node.type)) return []
  if (node.type === "text") {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    return start !== undefined && end !== undefined && text.slice(start, end) === node.value ? [{ start, end }] : []
  }
  return (node.children ?? []).flatMap((child) => prose(child, text))
}

function found(text: string, nicknames: ReadonlyMap<string, string>): Found[] {
  const labelOf = (name: string) => nicknames.get(name) ?? nicknames.get(name.toLowerCase())
  const hits: Found[] = []
  for (const span of prose(fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }), text)) {
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
