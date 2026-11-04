import type { Node } from "prosemirror-model"
import { TextSelection, type EditorState, type Transaction } from "prosemirror-state"

import { attrsOf, isSent, newBlockId, schema, type BlockAttrs, type BlockKind } from "~/chat/doc/schema"

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
  const attrs: BlockAttrs = { id: newBlockId(), kind, author, at, re: null, quote: null }
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

function atEnd(tr: Transaction, b: Placed): Transaction {
  return tr.setSelection(TextSelection.near(tr.doc.resolve(b.pos + b.node.nodeSize - 1), -1))
}

export function startBlock(state: EditorState, me: string, now: number, posted: (block: string) => boolean = () => false): Transaction {
  const tr = state.tr.setMeta("addToHistory", false)
  const all = blocks(state.doc)
  const yours = all.findLast((b) => attrsOf(b.node).author === me && attrsOf(b.node).kind === "text")
  if (yours && !isEmpty(yours.node) && !isSent(yours.node) && !posted(attrsOf(yours.node).id)) return atEnd(tr, yours)
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

export function replyIn(state: EditorState, me: string, now: number, re: number, quote: string | null, posted: (block: string) => boolean = () => false): Transaction {
  const tr = startBlock(state, me, now, posted)
  const here = blocks(tr.doc)[tr.selection.$from.index(0)]
  return here ? tr.setNodeMarkup(here.pos, undefined, { ...here.node.attrs, re, quote }) : tr
}

export function unreply(state: EditorState, id: string): Transaction | null {
  const b = blocks(state.doc).find((x) => attrsOf(x.node).id === id)
  if (!b) return null
  return state.tr.setMeta("addToHistory", false).setNodeMarkup(b.pos, undefined, { ...b.node.attrs, re: null, quote: null })
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

export function attach(state: EditorState, me: string, now: number, nodes: readonly Node[]): Transaction | null {
  if (!nodes.length) return null
  const here = blockAt(state)
  const own = here && attrsOf(here.node).author === me && attrsOf(here.node).kind === "text" && !isSent(here.node) ? here : null
  const tr = own ? state.tr : startBlock(state, me, now).setMeta("addToHistory", true)
  const index = own ? own.index : tr.selection.$from.index(0)
  const node = tr.doc.child(index)
  let pos = 0
  for (let i = 0; i < index; i++) pos += tr.doc.child(i).nodeSize
  const block = { pos }
  const last = node.lastChild
  const blank = last && last.type === schema.nodes.paragraph && last.content.size === 0
  const at = blank ? block.pos + node.nodeSize - 1 - last.nodeSize : block.pos + node.nodeSize - 1
  tr.insert(at, [...nodes, ...(blank ? [] : [schema.nodes.paragraph.create()])])
  const after = at + nodes.reduce((n, x) => n + x.nodeSize, 0) + 1
  return tr.setSelection(TextSelection.create(tr.doc, after)).scrollIntoView()
}

function atBlockStart(state: EditorState): boolean {
  const { $from, empty } = state.selection
  if (!empty || $from.depth < 2 || $from.parentOffset !== 0) return false
  for (let d = $from.depth - 1; d >= 1; d--) if ($from.index(d) !== 0) return false
  return true
}

function joinable(a: Node, b: Node, me: string, posted: (block: string) => boolean): boolean {
  const x = attrsOf(a)
  const y = attrsOf(b)
  return x.author === me && y.author === me && x.kind === y.kind && !isSent(a) && !isSent(b) && !posted(x.id) && !posted(y.id)
}

function joinInto(state: EditorState, prev: Placed, next: Placed): Transaction {
  const tr = state.tr
  const at = prev.pos + prev.node.nodeSize - 1
  tr.delete(next.pos, next.pos + next.node.nodeSize)
  tr.insert(at, next.node.content)
  const last = prev.node.lastChild
  const first = next.node.firstChild
  if (last?.isTextblock && first?.type === last.type) {
    tr.join(at)
    return tr.setSelection(TextSelection.create(tr.doc, at - 1)).scrollIntoView()
  }
  return tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1))).scrollIntoView()
}

export function joinBack(state: EditorState, me: string, posted: (block: string) => boolean = () => false): Transaction | null {
  const here = blockAt(state)
  if (!here || here.index === 0 || !atBlockStart(state)) return null
  const prevNode = state.doc.child(here.index - 1)
  const prev = { node: prevNode, pos: here.pos - prevNode.nodeSize, index: here.index - 1 }
  return joinable(prev.node, here.node, me, posted) ? joinInto(state, prev, here) : null
}

export function joinForward(state: EditorState, me: string, posted: (block: string) => boolean = () => false): Transaction | null {
  const here = blockAt(state)
  if (!here || here.index >= state.doc.childCount - 1 || !atBlockEnd(state)) return null
  const nextNode = state.doc.child(here.index + 1)
  const next = { node: nextNode, pos: here.pos + here.node.nodeSize, index: here.index + 1 }
  return joinable(here.node, next.node, me, posted) ? joinInto(state, here, next) : null
}
