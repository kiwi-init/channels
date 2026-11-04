import { Fragment, Node } from "prosemirror-model"
import type { EditorState } from "prosemirror-state"
import { ProsemirrorBinding, ySyncPluginKey, yXmlFragmentToProseMirrorRootNode } from "y-prosemirror"
import * as Y from "yjs"

import { attrsOf } from "~/chat/doc/schema"

interface Touched {
  lines: Set<string>
  gone: Set<string>
}

const idOf = (n: Node): string => (n.type.name === "block" ? attrsOf(n).id : "")

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
  const was = new Map<string, Node>()
  before.forEach((n) => void was.set(idOf(n), n))
  after.forEach((n) => {
    const id = idOf(n)
    if (was.get(id) !== n) into.lines.add(id)
    was.delete(id)
  })
  for (const id of was.keys()) into.gone.add(id)
}

function ownOnly(doc: Node, binding: ProsemirrorBinding, touched: Touched, missed: Set<string>): { safe: Node; behind: boolean } {
  const here = new Map<string, Node>()
  const order: string[] = []
  doc.forEach((n) => {
    here.set(idOf(n), n)
    order.push(idOf(n))
  })
  const els = binding.type.toArray()
  const ids = els.map((el) => (el instanceof Y.XmlElement ? el.getAttribute("id") : undefined))
  if (here.has("") || here.size !== order.length || ids.some((id) => typeof id !== "string" || !id)) return { safe: doc, behind: false }
  let fresh: Map<string, Node> | null = null
  const drawn = (el: Y.XmlElement, id: string): Node | null => {
    const mapped = binding.mapping.get(el)
    if (mapped instanceof Node) return mapped
    if (!fresh) {
      const all = new Map<string, Node>()
      yXmlFragmentToProseMirrorRootNode(binding.type, doc.type.schema).forEach((n) => void all.set(idOf(n), n))
      fresh = all
    }
    return fresh.get(id) ?? null
  }
  const out: Node[] = []
  let behind = false
  for (const [i, el] of els.entries()) {
    const id = ids[i]
    if (typeof id !== "string" || !(el instanceof Y.XmlElement) || touched.gone.has(id)) continue
    const mine = here.get(id)
    if (mine && touched.lines.has(id)) {
      out.push(mine)
      continue
    }
    const theirs = drawn(el, id)
    if (!theirs) return { safe: doc, behind: true }
    if (mine !== theirs || (missed.has(id) && shapeOfStored(el) !== shapeOfDrawn(theirs))) behind = true
    out.push(theirs)
  }
  const inY = new Set(ids)
  for (const [i, id] of order.entries()) {
    if (inY.has(id)) continue
    if (!touched.lines.has(id)) {
      behind = true
      continue
    }
    const prev = order.slice(0, i).findLast((p) => out.some((n) => idOf(n) === p))
    const at = prev === undefined ? 0 : out.findIndex((n) => idOf(n) === prev) + 1
    out.splice(at, 0, here.get(id)!)
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
  doc.forEach((n) => void (missed.has(idOf(n)) && shown.set(idOf(n), n)))
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
  const touched: Touched = { lines: new Set(), gone: new Set() }
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
