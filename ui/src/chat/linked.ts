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
  const escaped = (hit: Found) => text[hit.start - 1] === "\\" || text[hit.end] === "\\"
  for (const hit of hits.sort((a, b) => a.start - b.start)) if (!kept.length || hit.start >= (kept.at(-1)?.end ?? 0)) kept.push(hit)
  return kept.filter((hit) => !escaped(hit))
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

const NAME_GOES_ON = /[\p{L}\p{N}_-]|\.[\p{L}\p{N}]/uy
const NAME_BEFORE = /[\p{L}\p{N}_.@\\-]/u

export function mentionNames(people: readonly { name: string; display?: string | undefined }[]): { typed: (handle: string) => string; sent: (text: string) => string } {
  const taken = new Map<string, number>()
  const count = (key: string) => taken.set(key, (taken.get(key) ?? 0) + 1)
  for (const p of people) {
    count(p.name.toLowerCase())
    if (p.display && p.display.toLowerCase() !== p.name.toLowerCase()) count(p.display.toLowerCase())
  }
  const handleOf = new Map<string, string>()
  for (const p of people) if (p.display && p.display.toLowerCase() !== p.name.toLowerCase() && taken.get(p.display.toLowerCase()) === 1) handleOf.set(p.display.toLowerCase(), p.name)
  const longestFirst = [...handleOf.keys()].sort((a, b) => b.length - a.length)
  const typed = (handle: string) => {
    const display = people.find((p) => p.name === handle)?.display
    return display && handleOf.get(display.toLowerCase()) === handle ? display : handle
  }
  const sent = (text: string) => {
    let result = ""
    let from = 0
    for (const span of spansOf(text)) {
      for (let at = text.indexOf("@", span.start); at !== -1 && at < span.end; at = text.indexOf("@", at + 1)) {
        if (at > 0 && NAME_BEFORE.test(text[at - 1] ?? "")) continue
        const nick = longestFirst.find((n) => {
          const end = at + 1 + n.length
          NAME_GOES_ON.lastIndex = end
          return end <= span.end && text.slice(at + 1, end).toLowerCase() === n && !NAME_GOES_ON.test(text)
        })
        if (nick === undefined) continue
        result += `${text.slice(from, at)}@${handleOf.get(nick) ?? nick}`
        from = at + 1 + nick.length
        at = from - 1
      }
    }
    return result + text.slice(from)
  }
  return { typed, sent }
}

function unused(text: string): [string, string] {
  const free: string[] = []
  for (let code = 0xe000; free.length < 2; code++) if (!text.includes(String.fromCharCode(code))) free.push(String.fromCharCode(code))
  return [free[0] ?? "", free[1] ?? ""]
}

export function withNames(text: string, nicknames: ReadonlyMap<string, string>, plain: (text: string) => string): string {
  const [open, close] = unused(text)
  const labels: string[] = []
  const marked = swap(text, nicknames, (hit) => {
    if (hit.kind === "task") return null
    labels.push(`${hit.kind === "mention" ? "@" : ""}${hit.label}`)
    return `${open}${labels.length - 1}${close}`
  })
  return plain(marked).replace(new RegExp(`${open}(\\d+)${close}`, "g"), (whole: string, i: string) => labels[Number(i)] ?? whole)
}
