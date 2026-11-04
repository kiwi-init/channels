import * as Y from "yjs"

import { blockOf, markBack, markPosted, richOf, threadOf, type Block } from "@kiwi/core/doc/blocks.ts"

import { onGiveBack } from "~/chat/doc/give-back"
import { noteTyping } from "~/kit/typing-hook"

export interface Finished {
  id: string
  text: string
  re?: number
  quote?: string
}

interface Rule {
  me: string
  local: (origin: unknown) => boolean
  posted?: (block: string) => boolean
}

const isMine = (b: Block | null, me: string): b is Block => !!b && b.author === me && b.kind === "text"

export interface Posting {
  stop: () => void
}

export function postFinished(doc: Y.Doc, rule: Rule, post: (b: Finished) => void): Posting {
  const frag = threadOf(doc)
  const posted = new Set<string>()
  let stopped = false

  const known = (b: Block): boolean => posted.has(b.id) || !!b.sent || !!b.posted || (rule.posted?.(b.id) ?? false)

  const unsentBefore = (el: Y.XmlElement): Y.XmlElement[] => {
    const out: Y.XmlElement[] = []
    for (let n = el.prevSibling; n; n = n.prevSibling) {
      const b = blockOf(n)
      if (!isMine(b, rule.me) || !(n instanceof Y.XmlElement)) continue
      if (known(b)) break
      if (b.back) {
        if (n === el.prevSibling && b.text.trim()) out.unshift(n)
        break
      }
      if (b.text.trim()) out.unshift(n)
    }
    return out
  }

  const send = (el: Y.XmlElement): void => {
    const b = blockOf(el)
    if (!b) return
    posted.add(b.id)
    queueMicrotask(() => {
      if (!stopped) markPosted(doc, b.id)
      noteTyping(() => ({ what: "line posted", block: b.id }))
    })
    post({ id: b.id, text: richOf(el)?.markdown || b.text.trim(), ...(b.re ? { re: b.re } : {}), ...(b.quote ? { quote: b.quote } : {}) })
  }

  const look = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction): void => {
    if (!rule.local(tr.origin)) return
    for (const e of events) {
      if (e.target !== frag) continue
      for (const item of e.changes.added)
        for (const el of item.content.getContent()) {
          if (!(el instanceof Y.XmlElement) || !isMine(blockOf(el), rule.me)) continue
          for (const before of unsentBefore(el)) send(before)
        }
    }
  }

  const giveBack = (id: string): void => {
    posted.delete(id)
    markBack(doc, id)
    noteTyping(() => ({ what: "line given back", block: id }))
  }
  frag.observeDeep(look)
  const off = onGiveBack(giveBack)
  return {
    stop: () => {
      stopped = true
      off()
      frag.unobserveDeep(look)
    },
  }
}
