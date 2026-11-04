import * as Y from "yjs"

import { blockOf, markSent, threadOf, unmarkSent, type Block } from "@kiwi/core/doc/blocks.ts"

export interface Finished {
  id: string
  text: string
}

interface Rule {
  me: string
  local: (origin: unknown) => boolean
}

const isMine = (b: Block | null, me: string): b is Block => !!b && b.author === me && b.kind === "text"

export interface Posting {
  stop: () => void
  giveBack: (id: string) => void
}

export function postFinished(doc: Y.Doc, rule: Rule, post: (b: Finished) => void): Posting {
  const frag = threadOf(doc)
  const made = new Set<string>()
  const posted = new Set<string>()

  const send = (b: Block | null): void => {
    if (!b || posted.has(b.id) || !made.has(b.id) || !b.text.trim()) return
    posted.add(b.id)
    markSent(doc, b.id)
    post({ id: b.id, text: b.text.trim() })
  }

  const look = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction): void => {
    const local = rule.local(tr.origin)
    for (const e of events) {
      if (e.target !== frag) continue
      for (const item of e.changes.added)
        for (const el of item.content.getContent()) {
          const b = blockOf(el)
          if (!isMine(b, rule.me)) continue
          if (local) made.add(b.id)
          send(blockOf(el instanceof Y.XmlElement ? el.prevSibling : null))
        }
    }
  }

  frag.observeDeep(look)
  return {
    stop: () => frag.unobserveDeep(look),
    giveBack: (id) => {
      posted.delete(id)
      unmarkSent(doc, id)
    },
  }
}
