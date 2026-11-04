import { Fragment, Node, type Slice } from "prosemirror-model"
import { EditorState } from "prosemirror-state"
import { ProsemirrorBinding, ySyncPluginKey, yXmlFragmentToProseMirrorRootNode } from "y-prosemirror"
import * as Y from "yjs"

import { attrsOf } from "~/chat/doc/schema"

interface Touched {
  lines: Map<string, Node | null>
  gone: Set<string>
}

const idOf = (n: Node): string => (n.type.name === "block" ? attrsOf(n).id : "")

const unnamed = (key: string): boolean => key.startsWith("#")

function keysOf(names: readonly string[]): string[] {
  let k = 0
  return names.map((n) => n || `#${k++}`)
}

function keysOfDoc(doc: Node): string[] {
  const names: string[] = []
  doc.forEach((n) => void names.push(idOf(n)))
  return keysOf(names)
}

function byKey(doc: Node): Map<string, Node> {
  const keys = keysOfDoc(doc)
  return new Map(keys.map((k, i) => [k, doc.child(i)]))
}

function bindingOf(state: EditorState): ProsemirrorBinding | null {
  const got: unknown = ySyncPluginKey.getState(state)
  if (!got || typeof got !== "object" || !("binding" in got)) return null
  return got.binding instanceof ProsemirrorBinding ? got.binding : null
}

function rawOf(t: Y.XmlText): string {
  return (t.toDelta() as { insert: unknown }[]).map((d) => (typeof d.insert === "string" ? d.insert : "")).join("")
}

function shapeOfStored(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (!(node instanceof Y.XmlElement)) return ""
  let out = ""
  let words = ""
  for (const c of node.toArray()) {
    if (c instanceof Y.XmlText) words += rawOf(c)
    else {
      if (words) out += JSON.stringify(words)
      words = ""
      out += shapeOfStored(c)
    }
  }
  if (words) out += JSON.stringify(words)
  return `${node.nodeName}(${out})`
}

function shapeOfDrawn(node: Node): string {
  let out = ""
  let words = ""
  node.forEach((c) => {
    if (c.isText) words += c.text ?? ""
    else {
      if (words) out += JSON.stringify(words)
      words = ""
      out += shapeOfDrawn(c)
    }
  })
  if (words) out += JSON.stringify(words)
  return `${node.type.name}(${out})`
}

function topLine(t: Y.AbstractType<unknown>, root: Y.XmlFragment): string | null {
  let at: Y.AbstractType<unknown> | null = t
  while (at && at.parent !== root) at = at.parent instanceof Y.AbstractType ? at.parent : null
  const id = at instanceof Y.XmlElement ? at.getAttribute("id") : undefined
  return typeof id === "string" && id ? id : null
}

function noteTouched(before: Node, after: Node, into: Touched): void {
  const was = byKey(before)
  for (const [id, n] of byKey(after)) {
    if (was.get(id) !== n && !into.lines.has(id)) into.lines.set(id, was.get(id) ?? null)
    was.delete(id)
  }
  for (const id of was.keys()) into.gone.add(id)
}

const lowHalf = (s: string, at: number): boolean => {
  const c = s.charCodeAt(at)
  return c >= 0xdc00 && c <= 0xdfff
}

const splitsPair = (n: Node, at: number): boolean => at > 0 && at < n.content.size && lowHalf(n.textBetween(at, at + 1, "", ""), 0)

function diffOf(a: Node, b: Node): { from: number; toA: number; toB: number } | null {
  let from = a.content.findDiffStart(b.content)
  if (from === null) return null
  if (splitsPair(a, from) || splitsPair(b, from)) from--
  let { a: toA, b: toB } = a.content.findDiffEnd(b.content) ?? { a: a.content.size, b: b.content.size }
  const over = from - Math.min(toA, toB)
  if (over > 0) {
    toA += over
    toB += over
  }
  if (splitsPair(a, toA) || splitsPair(b, toB)) {
    toA++
    toB++
  }
  return { from, toA, toB }
}

function placed(stored: Node, from: number, to: number, slice: Slice): Node | null {
  try {
    const doc = stored.type.schema.topNodeType.create(null, stored)
    const tr = EditorState.create({ doc }).tr.replace(from + 1, to + 1, slice)
    const line = tr.doc.childCount === 1 ? tr.doc.child(0) : null
    return line && (tr.docChanged || (slice.size === 0 && from === to)) ? line : null
  } catch {
    // a slice that can't fit here is tried at the next place
    return null
  }
}

function rebase(drawn: Node, now: Node, stored: Node): Node | null {
  const mine = diffOf(drawn, now)
  if (!mine) return stored
  const slice = now.slice(mine.from, mine.toB)
  const theirs = diffOf(drawn, stored)
  const end = stored.content.size
  if (!theirs || mine.from >= theirs.toA) {
    const shift = theirs ? theirs.toB - theirs.toA : 0
    return placed(stored, mine.from + shift, mine.toA + shift, slice) ?? placed(stored, end, end, slice)
  }
  if (mine.toA <= theirs.from) return placed(stored, mine.from, mine.toA, slice) ?? placed(stored, end, end, slice)
  const at = Math.min(mine.from, theirs.from)
  return placed(stored, at, at, slice) ?? placed(stored, end, end, slice)
}

function ownOnly(doc: Node, binding: ProsemirrorBinding, touched: Touched, missed: Set<string>): { safe: Node; behind: boolean } {
  const order = keysOfDoc(doc)
  const here = byKey(doc)
  const els = binding.type.toArray()
  const stored = els.filter((el): el is Y.XmlElement => el instanceof Y.XmlElement)
  const ids = keysOf(
    stored.map((el) => {
      const id = el.getAttribute("id")
      return typeof id === "string" ? id : ""
    })
  )
  if (stored.length !== els.length || here.size !== order.length || new Set(ids).size !== ids.length) return { safe: doc, behind: false }
  let fresh: Map<string, Node> | null = null
  const storedNow = (id: string): Node | null => {
    fresh ??= byKey(yXmlFragmentToProseMirrorRootNode(binding.type, doc.type.schema))
    return fresh.get(id) ?? null
  }
  const drawn = (el: Y.XmlElement, id: string): Node | null => {
    const mapped = binding.mapping.get(el)
    return mapped instanceof Node ? mapped : storedNow(id)
  }
  const merged = new Map<string, Node>()
  for (const [i, el] of stored.entries()) {
    const id = ids[i]!
    const drawnBefore = touched.lines.get(id)
    const now = here.get(id)
    const theirs = drawnBefore && now && shapeOfStored(el) !== shapeOfDrawn(drawnBefore) ? storedNow(id) : null
    if (!drawnBefore || !now || !theirs) continue
    merged.set(id, rebase(drawnBefore, now, theirs) ?? theirs)
  }
  const out: Node[] = []
  const outKeys: string[] = []
  let behind = merged.size > 0
  for (const [i, el] of stored.entries()) {
    const id = ids[i]!
    if (touched.gone.has(id)) continue
    const mine = here.get(id)
    const keep = !!mine && touched.lines.has(id) && !merged.has(id)
    const theirs = keep ? mine : (merged.get(id) ?? drawn(el, id))
    if (!theirs) return { safe: doc, behind: true }
    if (!keep && (theirs !== mine || (missed.has(id) && shapeOfStored(el) !== shapeOfDrawn(theirs)))) behind = true
    out.push(theirs)
    outKeys.push(id)
  }
  const inY = new Set(ids)
  for (const [i, id] of order.entries()) {
    if (inY.has(id)) continue
    if (!touched.lines.has(id)) {
      if (!unnamed(id)) behind = true
      continue
    }
    const prev = order.slice(0, i).findLast((p) => outKeys.includes(p))
    const at = prev === undefined ? 0 : outKeys.indexOf(prev) + 1
    out.splice(at, 0, here.get(id)!)
    outKeys.splice(at, 0, id)
  }
  return { safe: doc.copy(Fragment.from(out)), behind }
}

function outOfStep(doc: Node, root: Y.XmlFragment, missed: Set<string>): boolean {
  const stored = new Map<string, Y.XmlElement>()
  for (const el of root.toArray()) {
    const id = el instanceof Y.XmlElement ? el.getAttribute("id") : undefined
    if (el instanceof Y.XmlElement && typeof id === "string" && missed.has(id)) stored.set(id, el)
  }
  const shown = new Map<string, Node>()
  for (const [id, n] of byKey(doc)) if (missed.has(id)) shown.set(id, n)
  let behind = false
  for (const id of missed) {
    const el = stored.get(id)
    const n = shown.get(id)
    if (!el && !n) missed.delete(id)
    else if (el && n && shapeOfStored(el) === shapeOfDrawn(n)) missed.delete(id)
    else behind = true
  }
  return behind
}

export interface OwnWrites {
  touched: (before: Node, after: Node) => void
  stop: () => void
}

export function writeOwnLinesOnly(state: EditorState, shown: () => Node | null): OwnWrites | null {
  const binding = bindingOf(state)
  if (!binding) return null
  const touched: Touched = { lines: new Map(), gone: new Set() }
  const missed = new Set<string>()
  const write = binding._prosemirrorChanged.bind(binding)
  let redrawing = false
  let stopped = false
  const redraw = (): void => {
    redrawing = false
    const view: unknown = binding.prosemirrorView
    if (stopped || !view || typeof view !== "object" || ("isDestroyed" in view && view.isDestroyed === true)) return
    binding._forceRerender()
    missed.clear()
  }
  const soon = (): void => {
    if (redrawing) return
    redrawing = true
    queueMicrotask(redraw)
  }
  const check = (): void => {
    const doc = shown()
    if (!stopped && doc && missed.size && outOfStep(doc, binding.type, missed)) soon()
  }
  const watch = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction): void => {
    if (tr.origin === ySyncPluginKey) return
    for (const e of events) {
      const id = topLine(e.target, binding.type)
      if (id) missed.add(id)
    }
    if (missed.size) queueMicrotask(check)
  }
  binding.type.observeDeep(watch)
  binding._prosemirrorChanged = (doc) => {
    const { safe, behind } = ownOnly(doc, binding, touched, missed)
    touched.lines.clear()
    touched.gone.clear()
    write(safe)
    if (behind) soon()
  }
  return {
    touched: (before, after) => noteTouched(before, after, touched),
    stop: () => {
      stopped = true
      binding.type.unobserveDeep(watch)
    },
  }
}
