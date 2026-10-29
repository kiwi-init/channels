import { bareAt, memberNamed, readsAsHandle } from "@kiwi/core/state.ts"
import { fromMarkdown } from "mdast-util-from-markdown"
import { gfmFromMarkdown } from "mdast-util-gfm"
import { gfm } from "micromark-extension-gfm"
import { sanitizeMarkdownUrl } from "@kiwi/app/markdown.ts"

type MdNode = { type: string; value?: string; url?: string; alt?: string | null; children?: MdNode[]; position?: { start: { offset?: number }; end: { offset?: number } } }

type Found = { start: number; end: number } & (
  | { kind: "mention" | "bare"; name: string; label: string }
  | { kind: "task"; id: number }
  | { kind: "ref"; seq: number }
  | { kind: "image"; url: string; alt: string }
)

const NOT_PROSE = new Set(["link", "linkReference", "definition", "image", "imageReference", "code", "inlineCode", "html"])
const MENTION = /(?<![\p{L}\p{N}_.@-])@([\p{L}\p{N}_.-]+)/gu
const TASK = /\bT(\d+)\b/g
const REF = /(?<![\p{L}\p{N}\p{M}_/#&.-])#([1-9]\d{0,8})(?![\p{L}\p{N}\p{M}_])/gu
const NOT_A_MESSAGE = /\b(?:PR|pr|pull|issue|Issue|issues|Issues)\s*$/
const WORD = /(?<![\p{L}\p{N}\p{M}_/.@-])[\p{L}\p{N}_.-]+/gu

type Span = { start: number; end: number }

type Image = Span & { url: string; alt: string }

function images(node: MdNode): Image[] {
  if (node.type === "image") {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    return start !== undefined && end !== undefined && node.url !== undefined ? [{ start, end, url: node.url, alt: node.alt ?? "" }] : []
  }
  return (node.children ?? []).flatMap(images)
}

function prose(node: MdNode): Span[] {
  if (NOT_PROSE.has(node.type)) return []
  if (node.type === "text") {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    return start !== undefined && end !== undefined ? [{ start, end }] : []
  }
  return (node.children ?? []).flatMap(prose)
}

const parsed = new Map<string, { spans: Span[]; images: Image[] }>()

function treeOf(text: string): { spans: Span[]; images: Image[] } {
  const known = parsed.get(text)
  if (known) return known
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const next = { spans: prose(tree), images: images(tree) }
  if (parsed.size >= 500) parsed.delete(parsed.keys().next().value ?? "")
  parsed.set(text, next)
  return next
}

const spansOf = (text: string): Span[] => treeOf(text).spans

function found(text: string, nicknames: ReadonlyMap<string, string>, before?: number): Found[] {
  const labelOf = (name: string) => nicknames.get(name) ?? nicknames.get(name.toLowerCase())
  const { spans, images: pictures } = treeOf(text)
  const hits: Found[] = pictures.map((p) => ({ kind: "image", ...p }))
  for (const span of spans) {
    const part = text.slice(span.start, span.end)
    for (const m of part.matchAll(MENTION)) {
      const who = memberNamed(m[1] ?? "", labelOf)
      if (who) hits.push({ kind: "mention", ...who, start: span.start + m.index, end: span.start + m.index + 1 + who.name.length })
    }
    for (const m of part.matchAll(TASK)) hits.push({ kind: "task", id: Number(m[1]), start: span.start + m.index, end: span.start + m.index + m[0].length })
    if (before !== undefined)
      for (const m of part.matchAll(REF)) {
        const seq = Number(m[1])
        if (seq < before && !NOT_A_MESSAGE.test(part.slice(0, m.index))) hits.push({ kind: "ref", seq, start: span.start + m.index, end: span.start + m.index + m[0].length })
      }
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

function swap(text: string, nicknames: ReadonlyMap<string, string>, out: (hit: Found) => string | null, before?: number): string {
  let result = ""
  let from = 0
  for (const hit of found(text, nicknames, before)) {
    const said = out(hit)
    if (said === null) continue
    result += text.slice(from, hit.start) + said
    from = hit.end
  }
  return result + text.slice(from)
}

const literal = (text: string): string => text.replace(/[\\`*_[\]()<>&!|~]/g, "\\$&")

function remote(url: string, alt: string): string | null {
  if (/^(?:data|blob):/i.test(url.trim())) return null
  const safe = sanitizeMarkdownUrl(url)
  if (!safe || !/^https?:\/\//i.test(safe)) return literal(alt)
  const at = new URL(safe)
  return `[${literal(alt || "image")} (opens ${at.hostname})](<${at.href}>)`
}

export function linked(text: string, nicknames: ReadonlyMap<string, string>, tasks: ReadonlySet<number>, before?: number): string {
  return swap(
    text,
    nicknames,
    (hit) =>
      hit.kind === "task"
        ? tasks.has(hit.id)
          ? `[T${hit.id}](kiwi-task:${hit.id})`
          : null
        : hit.kind === "ref"
          ? `[#${hit.seq}](kiwi-msg:${hit.seq})`
          : hit.kind === "image"
            ? remote(hit.url, hit.alt)
            : `[${hit.kind === "mention" ? "@" : ""}${literal(hit.label)}](kiwi-mention:${hit.name})`,
    before
  )
}

export function named(text: string, nicknames: ReadonlyMap<string, string>): string {
  return swap(text, nicknames, (hit) => (hit.kind === "mention" || hit.kind === "bare" ? `${hit.kind === "mention" ? "@" : ""}${hit.label}` : null))
}

const NAME_GOES_ON = /[\p{L}\p{N}\p{M}_\\-]|[./][\p{L}\p{N}]/uy
const NAME_BEFORE = /[\p{L}\p{N}\p{M}_.@\\/-]$/u
const MARKUP = /[\\`*[\]<>|~]|^_|_$/

type Named = { name: string; display?: string | undefined }

export function mentionNames(people: readonly Named[], former: readonly Named[] = []): { typed: (handle: string) => string; sent: (text: string) => string } {
  const fold = (s: string) => s.toLowerCase()
  const taken = new Map<string, number>()
  const count = (key: string) => taken.set(key, (taken.get(key) ?? 0) + 1)
  for (const p of [...people, ...former]) {
    count(fold(p.name))
    if (p.display && fold(p.display) !== fold(p.name)) count(fold(p.display))
  }
  const nicks = people
    .flatMap((p) => (p.display && fold(p.display) !== fold(p.name) && taken.get(fold(p.display)) === 1 ? [{ display: p.display, handle: p.name }] : []))
    .sort((a, b) => b.display.length - a.display.length)
  const sent = (text: string) => {
    let result = ""
    let from = 0
    for (const span of spansOf(text)) {
      for (let at = text.indexOf("@", span.start); at !== -1 && at < span.end; at = text.indexOf("@", at + 1)) {
        if (NAME_BEFORE.test(text.slice(0, at))) continue
        const hit = nicks.find(({ display }) => {
          const end = at + 1 + display.length
          NAME_GOES_ON.lastIndex = end
          return end <= span.end && fold(text.slice(at + 1, end)) === fold(display) && !NAME_GOES_ON.test(text)
        })
        if (!hit) continue
        result += `${text.slice(from, at)}@${hit.handle}`
        from = at + 1 + hit.display.length
        at = from - 1
      }
    }
    return result + text.slice(from)
  }
  const typed = (handle: string) => {
    const display = nicks.find((n) => n.handle === handle)?.display
    return display && !MARKUP.test(display) && sent(`@${display} x`) === `@${handle} x` ? display : handle
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
    if (hit.kind !== "mention" && hit.kind !== "bare") return null
    labels.push(`${hit.kind === "mention" ? "@" : ""}${hit.label}`)
    return `${open}${labels.length - 1}${close}`
  })
  return plain(marked).replace(new RegExp(`${open}(\\d+)${close}`, "g"), (whole: string, i: string) => labels[Number(i)] ?? whole)
}
