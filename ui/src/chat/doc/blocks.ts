import type { Node } from "prosemirror-model"
import { TextSelection, type EditorState, type Transaction } from "prosemirror-state"

import { attrsOf, newBlockId, schema, type BlockAttrs, type BlockKind } from "~/chat/doc/schema"

const RUN_MS = 5 * 60_000

export interface Placed {
  node: Node
  pos: number
  index: number
}

export function blocks(doc: Node): Placed[] {
  const out: Placed[] = []
  doc.forEach((node, pos, index) => out.push({ node, pos, index }))
  return out
}

export function isEmpty(block: Node): boolean {
  if (block.childCount > 1) return false
  const only = block.firstChild
  return !only || (only.isTextblock && only.content.size === 0)
}

export function blockAt(state: EditorState): Placed | null {
  const $from = state.selection.$from
  if ($from.depth < 1) return null
  const index = $from.index(0)
  const node = state.doc.child(index)
  return { node, pos: $from.before(1), index }
}

export function makeBlock(kind: BlockKind, author: string, at: number, text = ""): Node {
  const attrs: BlockAttrs = { id: newBlockId(), kind, author, at }
  return schema.nodes.block.create(attrs, schema.nodes.paragraph.create(null, text ? schema.text(text) : null))
}

export function continues(prev: Node | undefined, next: Node): boolean {
  if (!prev) return false
  const a = attrsOf(prev)
  const b = attrsOf(next)
  return a.author !== "" && a.author === b.author && a.kind === b.kind && b.at - a.at < RUN_MS
}

function inside(tr: Transaction, pos: number): Transaction {
  return tr.setSelection(TextSelection.create(tr.doc, pos + 2))
}

export function startBlock(state: EditorState, me: string, now: number): Transaction {
  const tr = state.tr.setMeta("addToHistory", false)
  const all = blocks(state.doc)
  const last = all.at(-1)
  if (last && isEmpty(last.node)) {
    const a = attrsOf(last.node)
    if (a.author === me) return inside(tr, last.pos)
    if (a.author === "") {
      tr.setNodeMarkup(last.pos, undefined, { ...a, id: a.id || newBlockId(), kind: "text", author: me, at: now })
      return inside(tr, last.pos)
    }
  }
  const at = state.doc.content.size
  tr.insert(at, makeBlock("text", me, now))
  return inside(tr, at)
}

export function blockAfter(state: EditorState, me: string, now: number): Transaction | null {
  const here = blockAt(state)
  if (!here) return null
  const end = here.pos + here.node.nodeSize
  const tr = state.tr.setMeta("addToHistory", false)
  const $from = state.selection.$from
  const para = $from.parent
  const lastPara = $from.index(1) === here.node.childCount - 1
  if (state.selection.empty && para.type === schema.nodes.paragraph && para.content.size === 0 && lastPara && here.node.childCount > 1) {
    const from = $from.before(2)
    tr.delete(from, from + para.nodeSize)
  }
  const at = tr.mapping.map(end)
  tr.insert(at, makeBlock("text", me, now))
  return inside(tr, at)
}

export function atBlockEnd(state: EditorState): boolean {
  const { $from, empty } = state.selection
  if (!empty || $from.depth < 2 || $from.parentOffset !== $from.parent.content.size) return false
  for (let d = $from.depth - 1; d >= 1; d--) if ($from.index(d) !== $from.node(d).childCount - 1) return false
  return true
}

export function endsBlock(state: EditorState): boolean {
  const { $from } = state.selection
  if (!atBlockEnd(state) || $from.depth !== 2 || $from.parent.type !== schema.nodes.paragraph) return false
  return $from.parent.content.size > 0 || $from.node(1).childCount > 1
}

export function dropEmptyOwn(state: EditorState, me: string, keep: number | null): Transaction | null {
  const gone = blocks(state.doc).filter((b) => b.index !== keep && isEmpty(b.node) && attrsOf(b.node).author === me)
  if (gone.length === 0 || gone.length === state.doc.childCount) return null
  const tr = state.tr.setMeta("addToHistory", false)
  for (const b of gone.reverse()) tr.delete(b.pos, b.pos + b.node.nodeSize)
  return tr
}
