import type { Node } from "prosemirror-model"
import { TextSelection, type EditorState, type Transaction } from "prosemirror-state"
import type * as Y from "yjs"

import { attachToBlock, blocksOf, type BlockMedia } from "@kiwi/core/doc/blocks.ts"
import { blockAt, blocks, startBlock, type Made } from "~/chat/doc/blocks"
import { attrsOf, fileOf, imageOf, isSent, schema } from "~/chat/doc/schema"

const pending = new Map<string, number>()
const waiting = new Map<string, (() => void)[]>()

export const uploading = (block: string): boolean => (pending.get(block) ?? 0) > 0

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

export function attachToDoc(doc: Y.Doc, me: string, id: string, nodes: readonly Node[]): boolean {
  const b = blocksOf(doc).find((x) => x.id === id)
  if (!b || b.author !== me || b.sent) return false
  const media = nodes.flatMap((n): BlockMedia[] => {
    if (n.type === schema.nodes.image) return [{ image: imageOf(n) }]
    const file = fileOf(n)
    return file ? [{ file }] : []
  })
  return attachToBlock(doc, id, media)
}
