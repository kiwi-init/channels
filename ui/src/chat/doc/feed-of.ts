import type { Block, RichBlock } from "@kiwi/core/doc/blocks.ts"
import { laterLines } from "@kiwi/core/doc/ends.ts"
import { docFeeds, type DocFeed, type Line } from "~/chat/doc/finished"
import type { BlockFiles, Message } from "~/model"

const SHOWN: readonly Block["kind"][] = ["text", "agent", "comment"]

const NO_FILES: BlockFiles = { imgs: [], files: [] }

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

export function setDocFeed(key: string, feed: DocFeed): void {
  const now = docFeeds.get()
  if (same(now.get(key), feed)) return
  docFeeds.set(new Map([...now, [key, feed]]))
}

export const oldestAt = (messages: readonly Pick<Message, "at">[]): number => messages.reduce((min, m) => Math.min(min, m.at), Number.POSITIVE_INFINITY)
