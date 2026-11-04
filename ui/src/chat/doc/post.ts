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
  owned?: (b: Block) => boolean
  worked?: { add: (block: string) => unknown }
}

const isMine = (b: Block | null, me: string): b is Block => !!b && b.author === me && b.kind === "text"

export interface Posting {
  stop: () => void
}

export function postFinished(doc: Y.Doc, rule: Rule, post: (b: Finished) => void): Posting {
  const frag = threadOf(doc)
  const posted = new Set<string>()
  const here = new Set<string>()
  let stopped = false
  const owned = (b: Block): boolean => here.has(b.id) || (rule.owned?.(b) ?? false)

  const known = (b: Block): boolean => posted.has(b.id) || !!b.sent || !!b.posted || (rule.posted?.(b.id) ?? false)

  const lineBefore = (el: Y.XmlElement): Y.XmlElement | null => {
    for (let n = el.prevSibling; n; n = n.prevSibling) {
      const b = blockOf(n)
      if (!isMine(b, rule.me) || !(n instanceof Y.XmlElement)) continue
      if (known(b)) return null
      if (!owned(b)) continue
      return b.text.trim() && (!b.back || n === el.prevSibling) ? n : null
    }
    return null
  }

  const blockAround = (t: Y.AbstractType<unknown>): Block | null => {
    let n: Y.AbstractType<unknown> | null = t
    while (n && n.parent !== frag) n = n.parent instanceof Y.AbstractType ? n.parent : null
    return n ? blockOf(n) : null
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
      const b = e.target === frag ? null : blockAround(e.target)
      if (!isMine(b, rule.me)) continue
      here.add(b.id)
      rule.worked?.add(b.id)
    }
    for (const e of events) {
      if (e.target !== frag) continue
      for (const item of e.changes.added)
        for (const el of item.content.getContent()) {
          const made = el instanceof Y.XmlElement ? blockOf(el) : null
          if (!(el instanceof Y.XmlElement) || !isMine(made, rule.me)) continue
          here.add(made.id)
          const before = lineBefore(el)
          if (before) send(before)
        }
    }
  }

  const giveBack = (id: string): void => {
    posted.delete(id)
    here.add(id)
    rule.worked?.add(id)
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
