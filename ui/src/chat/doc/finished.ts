import type { Block, RichBlock } from "@kiwi/core/doc/blocks.ts"
import { laterLines } from "@kiwi/core/doc/ends.ts"
import { store } from "~/live/value"
import type { BlockFiles, Message, Where } from "~/model"
import { wrote } from "~/words"

export interface Line {
  id: string
  author: string
  at: number
  text: string
  media?: BlockFiles
}

export interface DocFeed {
  lines: readonly Line[]
  hidden: ReadonlySet<string>
  media: ReadonlyMap<string, BlockFiles>
}

const SHOWN: readonly Block["kind"][] = ["text", "agent", "comment"]

export const EMPTY_FEED: DocFeed = { lines: [], hidden: new Set(), media: new Map() }

const NO_FILES: BlockFiles = { imgs: [], files: [] }

export function withDocMedia(m: Message, media: BlockFiles | undefined): Message {
  const imgs = m.images?.length ? [] : (media?.imgs ?? [])
  const files = m.files?.length ? m.files : (media?.files ?? [])
  return imgs.length || files.length ? { ...m, docMedia: { imgs, files } } : m
}

export function mediaNames(m: Pick<Message, "block" | "images" | "docMedia">): string[] {
  const own = m.block === undefined ? [] : (m.images ?? [])
  return [...own.map((i) => `[image: ${i.alt}]`), ...(m.docMedia?.imgs ?? []).map((i) => `[image: ${i.name}]`), ...(m.docMedia?.files ?? []).map((f) => `[file: ${f.name}]`)]
}

export function withoutMediaNames(text: string, names: readonly string[]): string {
  if (!names.length) return text
  return names
    .reduce((t, n) => t.split(n).join(""), text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function docFeed(blocks: readonly Block[], rich: ReadonlyMap<string, RichBlock>, posted: ReadonlySet<string>, since: number, filesOf: (block: string) => BlockFiles = () => NO_FILES): DocFeed {
  const later = laterLines()
  const lines: Line[] = []
  const hidden = new Set<string>()
  const media = new Map<string, BlockFiles>()
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]!
    const done = b.sent || (!b.back && later.finish(b))
    later.add(b)
    const r = rich.get(b.id)
    if (!done) continue
    const files = r?.media ? filesOf(b.id) : null
    if (files) media.set(b.id, files)
    if (posted.has(b.id)) continue
    hidden.add(b.id)
    const text = (r?.markdown ?? b.text).trim()
    if (b.at >= since && (text || files) && SHOWN.includes(b.kind)) lines.push({ id: b.id, author: b.author, at: b.at, text, ...(files ? { media: files } : {}) })
  }
  return { lines: lines.reverse(), hidden, media }
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x))
const filesKey = (f: BlockFiles | undefined): string => (f ? [...f.imgs.map((i) => i.ref.id), ...f.files.map((x) => x.pieces.map((p) => p.id).join("+"))].join(",") : "")
const sameMedia = (a: ReadonlyMap<string, BlockFiles>, b: ReadonlyMap<string, BlockFiles>): boolean => a.size === b.size && [...a].every(([id, f]) => filesKey(f) === filesKey(b.get(id)))
const same = (a: DocFeed | undefined, b: DocFeed): boolean =>
  !!a &&
  a.lines.length === b.lines.length &&
  a.lines.every((x, i) => x.id === b.lines[i]!.id && x.text === b.lines[i]!.text && filesKey(x.media) === filesKey(b.lines[i]!.media)) &&
  sameSet(a.hidden, b.hidden) &&
  sameMedia(a.media, b.media)

export const docFeeds = store<ReadonlyMap<string, DocFeed>>(new Map())

export function setDocFeed(key: string, feed: DocFeed): void {
  const now = docFeeds.get()
  if (same(now.get(key), feed)) return
  docFeeds.set(new Map([...now, [key, feed]]))
}

export const oldestAt = (messages: readonly Pick<Message, "at">[]): number => messages.reduce((min, m) => Math.min(min, m.at), Number.POSITIVE_INFINITY)

export function withLines(list: readonly Message[], lines: readonly Line[], where: Where): Message[] {
  if (!lines.length) return [...list]
  const sorted = [...lines].sort((a, b) => a.at - b.at)
  const out: Message[] = []
  let k = 0
  let last = 0
  let n = 0
  const row = (l: Line): Message => ({ seq: last + ++n / 1000, from: l.author, at: l.at, text: wrote(l.text), block: l.id, where, fromDoc: true, ...(l.media ? { docMedia: l.media } : {}) })
  for (const m of list) {
    while (k < sorted.length && sorted[k]!.at < m.at) out.push(row(sorted[k++]!))
    out.push(m)
    last = m.seq
    n = 0
  }
  while (k < sorted.length) out.push(row(sorted[k++]!))
  return out
}
