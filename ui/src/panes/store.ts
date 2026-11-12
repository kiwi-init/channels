import { useSyncExternalStore } from "react"

import type { Where } from "~/model"
import { navigate, sameWhere, startNav, type Go, type Nav } from "~/nav"
import type { Tab } from "~/places"

export type Doc = { kind: "task"; task: number } | { kind: "now" }

export type Page = { at: "where"; where: Where } | { at: "tab"; tab: Exclude<Tab, "chat"> } | { at: "spec"; ask: number } | { at: "doc"; doc: Doc }

export type Carry = { page: Page } | { pane: string }

export type Edge = "left" | "right" | "top" | "bottom"

export interface Leaf {
  kind: "leaf"
  id: string
  nav: Nav | null
  doc?: Doc
}

export interface Split {
  kind: "split"
  id: string
  dir: "row" | "column"
  ratio: number
  fix?: { side: "a" | "b"; px: number | null }
  a: Node
  b: Node
}

export type Node = Leaf | Split

export interface Layout {
  root: Node
  focus: string
}

export interface Len {
  p: number
  px: number
  side: number
}

export interface Box {
  x: Len
  y: Len
  w: Len
  h: Len
}

export const MAIN = "main"
export const MIN_W = 240
export const MIN_H = 160

const NOWHERE: Where = { kind: "task", task: 0 }
const NONE: Len = { p: 0, px: 0, side: 0 }
const ALL: Len = { p: 1, px: 0, side: 0 }
const plus = (a: Len, b: Len): Len => ({ p: a.p + b.p, px: a.px + b.px, side: a.side + b.side })
const times = (a: Len, k: number): Len => ({ p: a.p * k, px: a.px * k, side: a.side * k })

export const isNone = (l: Len): boolean => l.p === 0 && l.px === 0 && l.side === 0
export const css = (l: Len): string => `calc(${l.p * 100}% + ${l.px}px + ${l.side} * var(--side-w))`
export const pixels = (l: Len, whole: number, side: number): number => l.p * whole + l.px + l.side * side

const ONLY: Leaf = { kind: "leaf", id: MAIN, nav: null }
export const ALONE: Layout = { root: ONLY, focus: MAIN }

const layouts = new Map<string, Layout>()
const listeners = new Set<() => void>()
let made = 0

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

const nowLeaf = (code: string): Leaf => ({ kind: "leaf", id: `pane-${++made}`, nav: { ...startNav(code), where: NOWHERE }, doc: { kind: "now" } })

const isNow = (leaf: Leaf): boolean => leaf.doc?.kind === "now"

const docked = (code: string, root: Node): Node => ({ kind: "split", id: `split-${++made}`, dir: "row", ratio: 0.7, fix: { side: "b", px: null }, a: root, b: nowLeaf(code) })

function layoutOf(code: string): Layout {
  const held = layouts.get(code)
  if (held) return held
  const first: Layout = { root: docked(code, ONLY), focus: MAIN }
  layouts.set(code, first)
  return first
}

function put(code: string, layout: Layout): void {
  layouts.set(code, layout)
  for (const l of listeners) l()
}

export const useLayout = (code: string): Layout => useSyncExternalStore(subscribe, () => layoutOf(code))

function findLeaf(node: Node, is: (leaf: Leaf) => boolean): Leaf | null {
  if (node.kind === "leaf") return is(node) ? node : null
  return findLeaf(node.a, is) ?? findLeaf(node.b, is)
}

export const leafOf = (node: Node, id: string): Leaf | null => findLeaf(node, (leaf) => leaf.id === id)

function swap(node: Node, id: string, to: (found: Node) => Node | null): Node | null {
  if (node.id === id) return to(node)
  if (node.kind === "leaf") return node
  const a = swap(node.a, id, to)
  const b = swap(node.b, id, to)
  if (a === node.a && b === node.b) return node
  if (!a) return b
  if (!b) return a
  return { ...node, a, b }
}

export const dockedNow = (root: Node): Leaf | null => (root.kind === "split" && root.fix?.side === "b" && root.b.kind === "leaf" && isNow(root.b) ? root.b : null)

export const without = (root: Node, id: string): Node => swap(root, id, () => null) ?? ONLY

function fresh(code: string, page: Page): Leaf {
  const base = startNav(code)
  const id = `pane-${++made}`
  if (page.at === "where") return { kind: "leaf", id, nav: { ...base, where: page.where } }
  if (page.at === "tab") return { kind: "leaf", id, nav: { ...base, tab: page.tab } }
  if (page.at === "spec") return { kind: "leaf", id, nav: { ...base, tab: "specs", spec: page.ask, part: "spec" } }
  if (page.doc.kind === "now") return nowLeaf(code)
  return { kind: "leaf", id, nav: { ...base, where: { kind: "task", task: page.doc.task } }, doc: page.doc }
}

const beside = (edge: Edge, leaf: Leaf, found: Node): Split => {
  const first = edge === "left" || edge === "top"
  return { kind: "split", id: `split-${++made}`, dir: edge === "left" || edge === "right" ? "row" : "column", ratio: 0.5, a: first ? leaf : found, b: first ? found : leaf }
}

export function splitAt(code: string, target: string, edge: Edge, page: Page): void {
  const layout = layoutOf(code)
  const leaf = fresh(code, page)
  const root = swap(layout.root, target, (found) => beside(edge, leaf, found))
  if (root && root !== layout.root) put(code, { root, focus: leaf.id })
}

export function movePane(code: string, id: string, target: string, edge: Edge): void {
  const layout = layoutOf(code)
  const leaf = leafOf(layout.root, id)
  if (!leaf || id === target || !leafOf(layout.root, target)) return
  const root = swap(without(layout.root, id), target, (found) => beside(edge, leaf, found))
  if (root) put(code, { root, focus: id })
}

export function closePane(code: string, id: string): void {
  const layout = layoutOf(code)
  if (id === MAIN || !leafOf(layout.root, id)) return
  put(code, { root: without(layout.root, id), focus: layout.focus === id ? MAIN : layout.focus })
}

export function resizeSplit(code: string, id: string, size: { ratio: number } | { px: number }): void {
  const layout = layoutOf(code)
  const root = swap(layout.root, id, (found) => {
    if (found.kind !== "split") return found
    return "px" in size && found.fix ? { ...found, fix: { ...found.fix, px: size.px } } : "ratio" in size ? { ...found, ratio: size.ratio } : found
  })
  if (root && root !== layout.root) put(code, { ...layout, root })
}

export function focusPane(code: string, id: string): void {
  const layout = layoutOf(code)
  if (layout.focus !== id) put(code, { ...layout, focus: id })
}

export function showDoc(code: string, id: string | null, doc: Doc, shown: boolean): void {
  const layout = layoutOf(code)
  const here = id ? leafOf(layout.root, id) : null
  if (here?.nav) {
    const where: Where = doc.kind === "task" ? { kind: "task", task: doc.task } : NOWHERE
    const root = swap(layout.root, here.id, () => ({ ...here, nav: { ...here.nav!, tab: "chat", where }, doc }))
    if (root) put(code, { ...layout, root })
    return
  }
  if (doc.kind !== "now") return splitAt(code, MAIN, "right", { at: "doc", doc })
  const now = findLeaf(layout.root, isNow)
  if (!now) {
    const root = docked(code, layout.root)
    return put(code, { root, focus: dockedNow(root)?.id ?? MAIN })
  }
  if (shown) return focusPane(code, now.id)
  movePane(code, now.id, MAIN, "right")
}

export function paneGo(code: string, id: string, go: Go): Go | null {
  const layout = layoutOf(code)
  const leaf = leafOf(layout.root, id)
  const nav = leaf?.nav
  if (!leaf || !nav) return go
  const show = (next: Leaf) => {
    const root = swap(layout.root, id, () => next)
    if (root) put(code, { ...layout, root })
    return null
  }
  if (go.to === "where" && go.person !== undefined && !leaf.doc && nav.tab === "chat" && sameWhere(nav.where, go.where)) return { to: "modal", modal: { kind: "person", name: go.person } }
  if (go.to === "where" || go.to === "tab" || go.to === "github" || go.to === "spec") return show({ kind: "leaf", id, nav: navigate(nav, go) })
  if (go.to === "task" && (leaf.doc || nav.tab !== "chat"))
    return show({ kind: "leaf", id, nav: { ...nav, tab: "chat", where: { kind: "task", task: go.task } }, doc: { kind: "task", task: go.task } })
  return go
}

export function boxes(root: Node): { leaves: { leaf: Leaf; box: Box }[]; gaps: { split: Split; box: Box; at: Len }[] } {
  const leaves: { leaf: Leaf; box: Box }[] = []
  const gaps: { split: Split; box: Box; at: Len }[] = []
  const walk = (node: Node, box: Box) => {
    if (node.kind === "leaf") return void leaves.push({ leaf: node, box })
    const row = node.dir === "row"
    const size = row ? box.w : box.h
    const fixed: Len | null = node.fix ? (node.fix.px === null ? { p: 0, px: 0, side: 1 } : { p: 0, px: node.fix.px, side: 0 }) : null
    const first = !fixed ? times(size, node.ratio) : node.fix?.side === "a" ? fixed : plus(size, times(fixed, -1))
    const rest = plus(size, times(first, -1))
    gaps.push({ split: node, box, at: plus(row ? box.x : box.y, first) })
    walk(node.a, row ? { ...box, w: first } : { ...box, h: first })
    walk(node.b, row ? { ...box, x: plus(box.x, first), w: rest } : { ...box, y: plus(box.y, first), h: rest })
  }
  walk(root, { x: NONE, y: NONE, w: ALL, h: ALL })
  return { leaves, gaps }
}

export interface Drag {
  carry: Carry
  label: string
  x: number
  y: number
  target: { code: string; id: string; edge: Edge; box: { x: number; y: number; w: number; h: number } } | null
}

let drag: Drag | null = null
const dragListeners = new Set<() => void>()
const subscribeDrag = (l: () => void) => (dragListeners.add(l), () => void dragListeners.delete(l))

export const useDrag = (): Drag | null => useSyncExternalStore(subscribeDrag, () => drag)

export function setDrag(next: Drag | null): void {
  drag = next
  for (const l of dragListeners) l()
}
