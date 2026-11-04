import type { Block, RichBlock } from "@kiwi/core/doc/blocks.ts"
import { store } from "~/live/value"
import type { Message, Where } from "~/model"

export interface Line {
  id: string
  author: string
  at: number
  text: string
}

export interface DocFeed {
  lines: readonly Line[]
  hidden: ReadonlySet<string>
  media: ReadonlySet<string>
}

const SHOWN: readonly Block["kind"][] = ["text", "agent", "comment"]

export const EMPTY_FEED: DocFeed = { lines: [], hidden: new Set(), media: new Set() }

export function docFeed(blocks: readonly Block[], rich: ReadonlyMap<string, RichBlock>, posted: ReadonlySet<string>, since: number): DocFeed {
  const later = new Set<string>()
  const lines: Line[] = []
  const hidden = new Set<string>()
  const media = new Set<string>()
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]!
    const done = b.sent || (!b.back && later.has(b.author))
    later.add(b.author)
    const r = rich.get(b.id)
    if (r?.media) {
      media.add(b.id)
      continue
    }
    if (!done || posted.has(b.id)) continue
    hidden.add(b.id)
    const text = (r?.markdown ?? b.text).trim()
    if (b.at >= since && text && SHOWN.includes(b.kind)) lines.push({ id: b.id, author: b.author, at: b.at, text })
  }
  return { lines: lines.reverse(), hidden, media }
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x))
const same = (a: DocFeed | undefined, b: DocFeed): boolean =>
  !!a && a.lines.length === b.lines.length && a.lines.every((x, i) => x.id === b.lines[i]!.id && x.text === b.lines[i]!.text) && sameSet(a.hidden, b.hidden) && sameSet(a.media, b.media)

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
  const row = (l: Line): Message => ({ seq: last + ++n / 1000, from: l.author, at: l.at, text: l.text, block: l.id, where, fromDoc: true })
  for (const m of list) {
    while (k < sorted.length && sorted[k]!.at < m.at) out.push(row(sorted[k++]!))
    out.push(m)
    last = m.seq
    n = 0
  }
  while (k < sorted.length) out.push(row(sorted[k++]!))
  return out
}
