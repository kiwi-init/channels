import type { Node } from "prosemirror-model"
import type { EditorState, Transaction } from "prosemirror-state"

import { blocks, isEmpty, type Made } from "~/chat/doc/blocks"
import { thisWindow } from "~/chat/doc/made"
import { attrsOf } from "~/chat/doc/schema"

export const LEFTOVER_GRACE_MS = 120_000

export interface Live {
  windows: ReadonlySet<string>
  carets: ReadonlySet<string>
  unknown: boolean
}

interface Seen {
  author: unknown
  win: unknown
  block: unknown
}

function seenIn(state: unknown): Seen | null {
  if (typeof state !== "object" || state === null || !("kiwi" in state)) return null
  const k = state.kiwi
  if (typeof k !== "object" || k === null) return null
  const sel = "selection" in k ? k.selection : null
  return {
    author: "author" in k ? k.author : null,
    win: "window" in k ? k.window : null,
    block: typeof sel === "object" && sel !== null && "block" in sel ? sel.block : null,
  }
}

export function liveOf(states: Iterable<unknown>, me: string): Live {
  const windows = new Set<string>()
  const carets = new Set<string>()
  let unknown = false
  for (const state of states) {
    const seen = seenIn(state)
    if (!seen) continue
    if (typeof seen.block === "string") carets.add(seen.block)
    if (seen.author !== me) continue
    if (typeof seen.win === "string" && seen.win) windows.add(seen.win)
    else unknown = true
  }
  return { windows, carets, unknown }
}

export function leftovers(doc: Node, me: string, now: number, live: Live, made: Made, unheld: Map<string, number>): string[] {
  if (live.unknown) {
    unheld.clear()
    return []
  }
  const out: string[] = []
  const seen = new Set<string>()
  doc.forEach((node) => {
    if (node.type.name !== "block" || !isEmpty(node)) return
    const a = attrsOf(node)
    if (a.author !== me || a.kind !== "text" || a.by === thisWindow || made(a.id) || live.windows.has(a.by) || live.carets.has(a.id)) return
    seen.add(a.id)
    const since = unheld.get(a.id) ?? now
    unheld.set(a.id, since)
    if (now - since >= LEFTOVER_GRACE_MS && now - a.at >= LEFTOVER_GRACE_MS) out.push(a.id)
  })
  for (const id of unheld.keys()) if (!seen.has(id)) unheld.delete(id)
  return out
}

export function dropLeftovers(state: EditorState, ids: readonly string[]): Transaction | null {
  if (!ids.length) return null
  const gone = new Set(ids)
  const all = blocks(state.doc)
  const drop = all.filter((b) => gone.has(attrsOf(b.node).id) && isEmpty(b.node))
  if (!drop.length || drop.length === all.length) return null
  const tr = state.tr.setMeta("addToHistory", false)
  for (const b of drop.reverse()) tr.delete(b.pos, b.pos + b.node.nodeSize)
  return tr
}
