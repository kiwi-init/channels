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
  typed: ReadonlySet<string>
}

const SHOWN: readonly Block["kind"][] = ["text", "agent", "comment"]

export const EMPTY_FEED: DocFeed = { lines: [], hidden: new Set(), media: new Map(), typed: new Set() }

const NO_FILES: BlockFiles = { imgs: [], files: [] }

function mirrors(own: NonNullable<Message["images"]>, imgs: BlockFiles["imgs"]): boolean {
  const left = imgs.map((i) => i.name)
  return own.every((i) => {
    const at = left.indexOf(i.alt)
    if (at >= 0) left.splice(at, 1)
    return at >= 0
  })
}

export function withDocMedia(m: Message, media: BlockFiles | undefined, typed = false): Message {
  const own = m.images ?? []
  const fromBlock = !own.length || (typed && !!media && mirrors(own, media.imgs))
  const imgs = fromBlock ? (media?.imgs ?? []) : []
  const files = m.files?.length ? m.files : (media?.files ?? [])
  if (!imgs.length && !files.length) return m
  const row = { ...m, docMedia: { imgs, files } }
  if (own.length && fromBlock) delete row.images
  return row
}

export function withoutMediaNames(text: string, media: BlockFiles): string {
  const names = [...media.imgs.map((i) => `[image: ${i.name}]`), ...media.files.map((f) => `[file: ${f.name}]`)]
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
  const typed = new Set<string>()
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]!
    const done = b.sent || (!b.back && later.finish(b))
    later.add(b)
    const r = rich.get(b.id)
    if (!done) continue
    const files = r?.media ? filesOf(b.id) : null
    if (files) media.set(b.id, files)
    if (files && b.kind === "text") typed.add(b.id)
    if (posted.has(b.id)) continue
    hidden.add(b.id)
    const text = (r?.markdown ?? b.text).trim()
    if (b.at >= since && (text || files) && SHOWN.includes(b.kind)) lines.push({ id: b.id, author: b.author, at: b.at, text, ...(files ? { media: files } : {}) })
  }
  return { lines: lines.reverse(), hidden, media, typed }
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x))
const filesKey = (f: BlockFiles | undefined): string => (f ? [...f.imgs.map((i) => i.ref.id), ...f.files.map((x) => x.pieces.map((p) => p.id).join("+"))].join(",") : "")
const sameMedia = (a: ReadonlyMap<string, BlockFiles>, b: ReadonlyMap<string, BlockFiles>): boolean => a.size === b.size && [...a].every(([id, f]) => filesKey(f) === filesKey(b.get(id)))
const same = (a: DocFeed | undefined, b: DocFeed): boolean =>
  !!a &&
  a.lines.length === b.lines.length &&
  a.lines.every((x, i) => x.id === b.lines[i]!.id && x.text === b.lines[i]!.text && filesKey(x.media) === filesKey(b.lines[i]!.media)) &&
  sameSet(a.hidden, b.hidden) &&
  sameSet(a.typed, b.typed) &&
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
