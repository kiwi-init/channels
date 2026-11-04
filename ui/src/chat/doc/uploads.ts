import type { Node } from "prosemirror-model"
import { TextSelection, type EditorState, type Transaction } from "prosemirror-state"

import { blockAt, blocks, startBlock, type Made } from "~/chat/doc/blocks"
import { attrsOf, isSent, schema } from "~/chat/doc/schema"

const pending = new Map<string, number>()
const waiting = new Map<string, (() => void)[]>()

const uploading = (block: string): boolean => (pending.get(block) ?? 0) > 0

export function startUpload(block: string): () => void {
  pending.set(block, (pending.get(block) ?? 0) + 1)
  let done = false
  return () => {
    if (done) return
    done = true
    const left = (pending.get(block) ?? 1) - 1
    if (left > 0) return void pending.set(block, left)
    pending.delete(block)
    const then = waiting.get(block) ?? []
    waiting.delete(block)
    for (const f of then) f()
  }
}

export function afterUploads(block: string, then: () => void): boolean {
  if (!uploading(block)) return false
  waiting.set(block, [...(waiting.get(block) ?? []), then])
  return true
}

export function uploadTarget(state: EditorState, me: string, now: number, made: Made): { id: string; tr: Transaction | null } {
  const here = blockAt(state)
  const a = here ? attrsOf(here.node) : null
  if (here && a && a.author === me && a.kind === "text" && !isSent(here.node)) return { id: a.id, tr: null }
  const tr = startBlock(state, me, now, undefined, made).setMeta("addToHistory", true)
  return { id: attrsOf(tr.doc.child(tr.selection.$from.index(0))).id, tr }
}

export function attachTo(state: EditorState, me: string, id: string, nodes: readonly Node[]): Transaction | null {
  if (!nodes.length) return null
  const b = blocks(state.doc).find((x) => attrsOf(x.node).id === id)
  if (!b || attrsOf(b.node).author !== me || isSent(b.node)) return null
  const last = b.node.lastChild
  const blank = !!last && last.type === schema.nodes.paragraph && last.content.size === 0
  const at = b.pos + b.node.nodeSize - 1 - (blank && last ? last.nodeSize : 0)
  const caretHere = state.selection.from > b.pos && state.selection.to < b.pos + b.node.nodeSize
  const tr = state.tr.insert(at, [...nodes, ...(blank ? [] : [schema.nodes.paragraph.create()])])
  if (!caretHere) return tr
  const after = at + nodes.reduce((n, x) => n + x.nodeSize, 0) + 1
  return tr.setSelection(TextSelection.create(tr.doc, after)).scrollIntoView()
}
