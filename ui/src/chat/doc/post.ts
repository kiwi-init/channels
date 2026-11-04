import * as Y from "yjs"

import { FINISH_IDLE_MS } from "@kiwi/core/doc/agent.ts"
import { blockOf, blocksOf, threadOf, type Block } from "@kiwi/core/doc/blocks.ts"

export interface Finished {
  id: string
  text: string
}

interface Rule {
  me: string
  local: (origin: unknown) => boolean
  idleMs?: number
}

const isMine = (b: Block | null, me: string): b is Block => !!b && b.author === me && b.kind === "text"

function topOf(type: Y.AbstractType<unknown>, frag: Y.XmlFragment): Y.XmlElement | null {
  let at: Y.AbstractType<unknown> | null = type
  while (at && at.parent !== frag) at = at.parent
  return at instanceof Y.XmlElement ? at : null
}

export function postFinished(doc: Y.Doc, rule: Rule, post: (b: Finished) => void): () => void {
  const frag = threadOf(doc)
  const idleMs = rule.idleMs ?? FINISH_IDLE_MS
  const made = new Set<string>()
  const posted = new Set<string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const send = (b: Block | null): void => {
    if (!b || posted.has(b.id) || !made.has(b.id) || !b.text.trim()) return
    const timer = timers.get(b.id)
    if (timer) clearTimeout(timer)
    timers.delete(b.id)
    posted.add(b.id)
    post({ id: b.id, text: b.text.trim() })
  }

  const arm = (id: string): void => {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        send(blocksOf(doc).find((b) => b.id === id) ?? null)
      }, idleMs)
    )
  }

  const look = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction): void => {
    const added = new Set<Y.XmlElement>()
    const touched = new Set<Y.XmlElement>()
    for (const e of events) {
      if (e.target !== frag) {
        const top = topOf(e.target, frag)
        if (top) touched.add(top)
        continue
      }
      for (const item of e.changes.added) for (const c of item.content.getContent()) if (c instanceof Y.XmlElement) added.add(c)
    }
    const local = rule.local(tr.origin)
    for (const el of [...added, ...touched]) {
      const b = blockOf(el)
      if (!isMine(b, rule.me)) continue
      if (local && added.has(el)) made.add(b.id)
      if (added.has(el)) send(blockOf(el.prevSibling))
      if (made.has(b.id) && !posted.has(b.id)) arm(b.id)
    }
  }

  frag.observeDeep(look)
  return () => {
    frag.unobserveDeep(look)
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
  }
}
