import { Fragment, Node } from "prosemirror-model"
import type { EditorState } from "prosemirror-state"
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

function sameEnds(a: string, b: string): { head: number; tail: number } {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  if (head > 0 && (lowHalf(a, head) || lowHalf(b, head))) head--
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  while (tail > 0 && (lowHalf(a, a.length - tail) || lowHalf(b, b.length - tail))) tail--
  return { head, tail }
}

interface Edit {
  words: Y.XmlText | Y.XmlElement
  at: number
  cut: number
  put: string
}

function plainParagraph(n: Node | undefined): string | null {
  if (!n || n.type.name !== "paragraph") return null
  let text = ""
  let plain = true
  n.forEach((c) => {
    if (c.isText) text += c.text ?? ""
    else plain = false
  })
  return plain ? text : null
}

function storedParagraph(el: Y.XmlElement | Y.XmlText | Y.XmlHook | null): { words: Y.XmlText | Y.XmlElement; text: string } | null {
  if (!(el instanceof Y.XmlElement) || el.nodeName !== "paragraph") return null
  if (el.length === 0) return { words: el, text: "" }
  const t = el.get(0)
  if (el.length !== 1 || !(t instanceof Y.XmlText)) return null
  const parts = (t.toDelta() as { insert: unknown }[]).map((d) => d.insert)
  return parts.every((x) => typeof x === "string") ? { words: t, text: parts.join("") } : null
}

function editOnto(drawn: string, now: string, stored: string): Omit<Edit, "words"> {
  const mine = sameEnds(drawn, now)
  const cut = drawn.length - mine.head - mine.tail
  const put = now.slice(mine.head, now.length - mine.tail)
  const theirs = sameEnds(drawn, stored)
  const from = mine.head
  const to = mine.head + cut
  if (from >= drawn.length - theirs.tail) return { at: stored.length - (drawn.length - from), cut, put }
  if (to <= theirs.head) return { at: from, cut, put }
  return { at: Math.min(from, theirs.head), cut: 0, put }
}

function mergeLine(el: Y.XmlElement, drawn: Node, now: Node): boolean {
  const stored = el.toArray()
  if (drawn.childCount !== now.childCount || drawn.childCount !== stored.length) return false
  const edits: Edit[] = []
  for (let i = 0; i < now.childCount; i++) {
    const was = drawn.child(i)
    const is = now.child(i)
    if (was === is || was.eq(is)) continue
    const a = plainParagraph(was)
    const b = plainParagraph(is)
    const y = storedParagraph(stored[i] ?? null)
    if (a === null || b === null || !y) return false
    edits.push({ words: y.words, ...editOnto(a, b, y.text) })
  }
  for (const e of edits) {
    const words = e.words instanceof Y.XmlText ? e.words : null
    if (!words) {
      if (e.put) e.words.insert(0, [new Y.XmlText(e.put)])
      continue
    }
    if (e.cut) words.delete(e.at, e.cut)
    if (e.put) words.insert(e.at, e.put)
  }
  return true
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
  const merged = new Set<string>()
  for (const [i, el] of stored.entries()) {
    const id = ids[i]!
    const drawnBefore = touched.lines.get(id)
    const now = here.get(id)
    if (!drawnBefore || !now || shapeOfStored(el) === shapeOfDrawn(drawnBefore)) continue
    mergeLine(el, drawnBefore, now)
    merged.add(id)
  }
  let fresh: Map<string, Node> | null = null
  const drawn = (el: Y.XmlElement, id: string): Node | null => {
    const mapped = merged.has(id) ? null : binding.mapping.get(el)
    if (mapped instanceof Node) return mapped
    fresh ??= byKey(yXmlFragmentToProseMirrorRootNode(binding.type, doc.type.schema))
    return fresh.get(id) ?? null
  }
  const out: Node[] = []
  const outKeys: string[] = []
  let behind = merged.size > 0
  for (const [i, el] of stored.entries()) {
    const id = ids[i]!
    if (touched.gone.has(id)) continue
    const mine = here.get(id)
    const keep = !!mine && touched.lines.has(id) && !merged.has(id)
    const theirs = keep ? mine : drawn(el, id)
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
