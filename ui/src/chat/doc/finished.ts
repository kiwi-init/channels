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

export const EMPTY_FEED: DocFeed = { lines: [], hidden: new Set(), media: new Map(), typed: new Set() }

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

export const docFeeds = store<ReadonlyMap<string, DocFeed>>(new Map())

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
