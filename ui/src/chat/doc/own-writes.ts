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

function ownOnly(doc: Node, binding: ProsemirrorBinding, touched: Touched): { safe: Node; behind: boolean } {
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
    if (mine !== theirs) behind = true
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

export function writeOwnLinesOnly(state: EditorState): ((before: Node, after: Node) => void) | null {
  const binding = bindingOf(state)
  if (!binding) return null
  const touched: Touched = { lines: new Set(), gone: new Set() }
  const write = binding._prosemirrorChanged.bind(binding)
  let redrawing = false
  const redraw = (): void => {
    redrawing = false
    const view: unknown = binding.prosemirrorView
    if (view && typeof view === "object" && !("isDestroyed" in view && view.isDestroyed === true)) binding._forceRerender()
  }
  binding._prosemirrorChanged = (doc) => {
    const { safe, behind } = ownOnly(doc, binding, touched)
    touched.lines.clear()
    touched.gone.clear()
    write(safe)
    if (behind && !redrawing) {
      redrawing = true
      queueMicrotask(redraw)
    }
  }
  return (before, after) => noteTouched(before, after, touched)
}
