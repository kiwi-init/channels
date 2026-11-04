import type { Block } from "@kiwi/core/doc/blocks.ts"
import { store } from "~/live/value"
import type { Message, Where } from "~/model"

export interface Line {
  id: string
  author: string
  at: number
  text: string
}

const SHOWN: readonly Block["kind"][] = ["text", "agent", "comment"]

export function finishedLines(blocks: readonly Block[], posted: ReadonlySet<string>): Line[] {
  const later = new Set<string>()
  const out: Line[] = []
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]!
    const done = b.sent || later.has(b.author)
    later.add(b.author)
    const text = b.text.trim()
    if (done && text && SHOWN.includes(b.kind) && !posted.has(b.id)) out.push({ id: b.id, author: b.author, at: b.at, text })
  }
  return out.reverse()
}

const same = (a: readonly Line[] | undefined, b: readonly Line[]): boolean => !!a && a.length === b.length && a.every((x, i) => x.id === b[i]!.id && x.text === b[i]!.text)

export const docLines = store<ReadonlyMap<string, readonly Line[]>>(new Map())

export function setDocLines(th: string, lines: readonly Line[]): void {
  const now = docLines.get()
  if (same(now.get(th), lines)) return
  docLines.set(new Map([...now, [th, lines]]))
}

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
