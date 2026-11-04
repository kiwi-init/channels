import { Fragment, Node, type Slice } from "prosemirror-model"
import { EditorState, TextSelection, type Selection, type Transaction } from "prosemirror-state"
import { getRelativeSelection, ProsemirrorBinding, updateYFragment, ySyncPluginKey, yXmlFragmentToProseMirrorRootNode } from "y-prosemirror"
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

interface Owned {
  safe: Node
  behind: boolean
  keys?: string[]
}

function ownOnly(doc: Node, binding: ProsemirrorBinding, touched: Touched, missed: Set<string>): Owned {
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
  return { safe: doc.copy(Fragment.from(out)), behind, keys: outKeys }
}

const storedKeys = (els: readonly (Y.XmlElement | Y.XmlText | Y.XmlHook)[]): string[] =>
  keysOf(
    els.map((el) => {
      const id = el instanceof Y.XmlElement ? el.getAttribute("id") : undefined
      return typeof id === "string" ? id : ""
    })
  )

function writeByLine(binding: ProsemirrorBinding, safe: Node, keys: readonly string[], gone: ReadonlySet<string>, state: EditorState | null): void {
  const root = binding.type
  binding.doc.transact(() => {
    const els = root.toArray()
    const elKeys = storedKeys(els)
    for (let i = els.length - 1; i >= 0; i--) {
      if (!gone.has(elKeys[i]!)) continue
      binding.mapping.delete(els[i]!)
      root.delete(i, 1)
    }
    const kept = els.flatMap((el, i) => (gone.has(elKeys[i]!) ? [] : [{ el, key: elKeys[i]! }]))
    const want = new Set(keys)
    let next = 0
    for (const [i, key] of keys.entries()) {
      while (next < kept.length && kept[next]!.key !== key && !want.has(kept[next]!.key)) next++
      const node = safe.child(i)
      const same = kept[next]?.key === key ? kept[next] : kept.find((k) => k.key === key)
      if (same) {
        if (same === kept[next]) next++
        if (same.el instanceof Y.XmlElement && binding.mapping.get(same.el) !== node) updateYFragment(binding.doc, same.el, node, binding)
        continue
      }
      const before = kept[next]?.el
      const at = before ? root.toArray().indexOf(before) : root.length
      const el = new Y.XmlElement(node.type.name)
      root.insert(at < 0 ? root.length : at, [el])
      updateYFragment(binding.doc, el, node, binding)
    }
    binding.mapping.set(root, safe)
    if (state) binding.beforeTransactionSelection = getRelativeSelection(binding, state)
  }, ySyncPluginKey)
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

function sameLines(doc: Node, root: Y.XmlFragment): boolean {
  const drawn = keysOfDoc(doc)
  const stored = keysOf(root.toArray().map((el) => (el instanceof Y.XmlElement && typeof el.getAttribute("id") === "string" ? String(el.getAttribute("id")) : "")))
  return drawn.length === stored.length && drawn.every((k, i) => k === stored[i])
}

export interface OwnWrites {
  touched: (before: Node, after: Node) => void
  stop: () => void
}

export interface Seen {
  state: EditorState
  dispatch: (tr: Transaction) => void
}

interface Spot {
  key: string
  at: number
}

function spotOf(doc: Node, pos: number): Spot | null {
  const $p = doc.resolve(pos)
  if ($p.depth < 1) return null
  const key = keysOfDoc(doc)[$p.index(0)]
  return key === undefined ? null : { key, at: pos - $p.before(1) }
}

function tokensOf(n: Node): string[] {
  const out: string[] = []
  n.forEach((c) => {
    if (c.isText) out.push(...(c.text ?? "").split(""))
    else if (c.isLeaf) out.push(`<${c.type.name} ${JSON.stringify(c.attrs)}>`)
    else out.push(`<${c.type.name}`, ...tokensOf(c), ">")
  })
  return out
}

interface Hunk {
  a0: number
  a1: number
  b0: number
  b1: number
}

const MAX_EDITS = 2_000
const CONTEXT = 24

function hunksOf(a: readonly string[], b: readonly string[]): Hunk[] | null {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const n = a.length - head - tail
  const m = b.length - head - tail
  if (!n && !m) return []
  if (!n || !m) return [{ a0: head, a1: head + n, b0: head, b1: head + m }]
  const inner = n < m ? within(b, head, m, a.slice(head, head + n)) : within(a, head, n, b.slice(head, head + m))
  if (inner !== null) {
    const out =
      n < m
        ? [
            { a0: head, a1: head, b0: head, b1: head + inner },
            { a0: head + n, a1: head + n, b0: head + inner + n, b1: head + m },
          ]
        : [
            { a0: head, a1: head + inner, b0: head, b1: head },
            { a0: head + inner + m, a1: head + n, b0: head + m, b1: head + m },
          ]
    return out.filter((h) => h.a1 > h.a0 || h.b1 > h.b0)
  }
  const most = Math.min(n + m, MAX_EDITS)
  const off = most + 1
  const v = new Int32Array(2 * most + 3)
  const trace: Int32Array[] = []
  const at = (x: number, y: number): boolean => a[head + x] === b[head + y]
  for (let d = 0; d <= most; d++) {
    trace.push(v.slice(off - d, off + d + 1))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && at(x, y)) {
        x++
        y++
      }
      v[off + k] = x
      if (x >= n && y >= m) return walkBack(trace, n, m, d, head)
    }
  }
  return null
}

function within(big: readonly string[], head: number, size: number, small: readonly string[]): number | null {
  const found = places(big.slice(head, head + size), small, 0)
  return found.length === 1 ? found[0]! : null
}

function walkBack(trace: Int32Array[], n: number, m: number, last: number, head: number): Hunk[] {
  const out: Hunk[] = []
  let x = n
  let y = m
  for (let d = last; d > 0; d--) {
    const v = trace[d]!
    const k = x - y
    const pk = k === -d || (k !== d && v[d + k - 1]! < v[d + k + 1]!) ? k + 1 : k - 1
    const px = v[d + pk]!
    const py = px - pk
    while (x > px && y > py) {
      x--
      y--
    }
    const step: Hunk = { a0: head + px, a1: head + x, b0: head + py, b1: head + y }
    const next = out[0]
    if (next && next.a0 === step.a1 && next.b0 === step.b1) out[0] = { a0: step.a0, a1: next.a1, b0: step.b0, b1: next.b1 }
    else out.unshift(step)
    x = px
    y = py
  }
  return out
}

function mapThrough(hunks: readonly Hunk[], p: number): number {
  let delta = 0
  for (const h of hunks) {
    if (p < h.a0 || (p === h.a0 && h.a1 > h.a0)) break
    if (p < h.a1) return h.b1
    delta = h.b1 - h.a1
  }
  return p + delta
}

function places(b: readonly string[], run: readonly string[], from: number): number[] {
  const out: number[] = []
  for (let i = from; i + run.length <= b.length && out.length < 2; i++) {
    let k = 0
    while (k < run.length && b[i + k] === run[k]) k++
    if (k === run.length) out.push(i)
  }
  return out
}

function onlyRun(b: readonly string[], runs: (k: number) => readonly string[], most: number, from: number): { at: number; len: number } | null {
  for (let k = most; k > 0; k--) {
    const run = runs(k)
    const at = places(b, run, from)
    if (at.length === 1) return { at: at[0]!, len: run.length }
    if (at.length > 1) return null
  }
  return null
}

function anchored(a: readonly string[], b: readonly string[], p: number): number | null {
  const left = onlyRun(b, (k) => a.slice(p - k, p), Math.min(CONTEXT, p), 0)
  const after = (from: number) => onlyRun(b, (k) => a.slice(p, p + k), Math.min(CONTEXT, a.length - p), from)
  if (!left) return after(0)?.at ?? null
  const q = left.at + left.len
  const right = after(q)
  return right && right.at === after(0)?.at ? right.at : q
}

function mapped(a: readonly string[], b: readonly string[], p: number): number {
  const hunks = hunksOf(a, b)
  if (hunks) return mapThrough(hunks, p)
  return anchored(a, b, p) ?? b.length
}

function placeOf(before: Node, after: Node, spot: Spot): number | null {
  const keys = keysOfDoc(after)
  const i = keys.indexOf(spot.key)
  const j = keysOfDoc(before).indexOf(spot.key)
  if (i < 0 || j < 0) return null
  let start = 0
  for (let k = 0; k < i; k++) start += after.child(k).nodeSize
  const now = after.child(i)
  const moved = mapped(tokensOf(before.child(j)), tokensOf(now), spot.at - 1)
  return start + 1 + Math.min(Math.max(moved, 0), now.content.size)
}

function keptSelection(before: EditorState, after: EditorState): Selection | null {
  const sel = before.selection
  if (!(sel instanceof TextSelection)) return null
  const anchor = spotOf(before.doc, sel.anchor)
  const head = spotOf(before.doc, sel.head)
  const a = anchor && placeOf(before.doc, after.doc, anchor)
  const h = head && placeOf(before.doc, after.doc, head)
  if (a === null || h === null) return null
  const $a = after.doc.resolve(a)
  const $h = after.doc.resolve(h)
  return $a.parent.inlineContent && $h.parent.inlineContent ? TextSelection.create(after.doc, a, h) : TextSelection.between($a, $h, -1)
}

export function writeOwnLinesOnly(state: EditorState, seen: () => Seen | null): OwnWrites | null {
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
    const before = seen()?.state ?? null
    binding._forceRerender()
    missed.clear()
    const now = seen()
    const kept = before && now ? keptSelection(before, now.state) : null
    if (now && kept && !kept.eq(now.state.selection)) now.dispatch(now.state.tr.setSelection(kept).setMeta(ySyncPluginKey, { isChangeOrigin: true }).setMeta("addToHistory", false))
  }
  const soon = (): void => {
    if (redrawing) return
    redrawing = true
    queueMicrotask(redraw)
  }
  let lines = false
  const check = (): void => {
    const doc = seen()?.state.doc ?? null
    const moved = lines
    lines = false
    if (stopped || !doc) return
    if ((moved && !sameLines(doc, binding.type)) || (missed.size && outOfStep(doc, binding.type, missed))) soon()
  }
  const watch = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction): void => {
    if (tr.origin === ySyncPluginKey) return
    for (const e of events) {
      if (e.target === binding.type) lines = true
      const id = topLine(e.target, binding.type)
      if (id) missed.add(id)
    }
    if (missed.size || lines) queueMicrotask(check)
  }
  binding.type.observeDeep(watch)
  binding._prosemirrorChanged = (doc) => {
    const { safe, behind, keys } = ownOnly(doc, binding, touched, missed)
    const gone = new Set(touched.gone)
    touched.lines.clear()
    touched.gone.clear()
    if (keys) writeByLine(binding, safe, keys, gone, seen()?.state ?? null)
    else write(safe)
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
