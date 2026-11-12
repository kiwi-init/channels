import { useSyncExternalStore } from "react"

import type { Where } from "~/model"
import { navigate, sameWhere, startNav, type Go, type Nav } from "~/nav"
import type { Tab } from "~/places"

export type Doc = { kind: "task"; task: number } | { kind: "spec"; ask: number }

export type Page = { at: "where"; where: Where } | { at: "tab"; tab: Exclude<Tab, "chat"> } | { at: "doc"; doc: Doc }

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
  a: Node
  b: Node
}

type Node = Leaf | Split

export interface Layout {
  root: Node
  focus: string
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export const MAIN = "main"
export const MIN_W = 280
export const MIN_H = 180

const WHOLE: Box = { x: 0, y: 0, w: 1, h: 1 }
export const ALONE: Layout = { root: { kind: "leaf", id: MAIN, nav: null }, focus: MAIN }

const layouts = new Map<string, Layout>()
const listeners = new Set<() => void>()
let made = 0

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

const layoutOf = (code: string): Layout => layouts.get(code) ?? ALONE

function put(code: string, layout: Layout): void {
  layouts.set(code, layout)
  for (const l of listeners) l()
}

export const useLayout = (code: string): Layout => useSyncExternalStore(subscribe, () => layoutOf(code))

export function leafOf(node: Node, id: string): Leaf | null {
  if (node.kind === "leaf") return node.id === id ? node : null
  return leafOf(node.a, id) ?? leafOf(node.b, id)
}

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

function fresh(code: string, page: Page): Leaf {
  const base = startNav(code)
  const id = `pane-${++made}`
  if (page.at === "where") return { kind: "leaf", id, nav: { ...base, where: page.where } }
  if (page.at === "tab") return { kind: "leaf", id, nav: { ...base, tab: page.tab } }
  return { kind: "leaf", id, nav: { ...base, tab: "specs" }, doc: page.doc }
}

export function splitAt(code: string, target: string, edge: Edge, page: Page): void {
  const layout = layoutOf(code)
  const leaf = fresh(code, page)
  const first = edge === "left" || edge === "top"
  const root = swap(layout.root, target, (found) => ({
    kind: "split",
    id: `split-${++made}`,
    dir: edge === "left" || edge === "right" ? "row" : "column",
    ratio: 0.5,
    a: first ? leaf : found,
    b: first ? found : leaf,
  }))
  if (root && root !== layout.root) put(code, { root, focus: leaf.id })
}

export function closePane(code: string, id: string): void {
  const layout = layoutOf(code)
  if (id === MAIN) return
  const root = swap(layout.root, id, () => null)
  if (root) put(code, { root, focus: layout.focus === id ? MAIN : layout.focus })
}

export function resizeSplit(code: string, id: string, ratio: number): void {
  const layout = layoutOf(code)
  const root = swap(layout.root, id, (found) => (found.kind === "split" ? { ...found, ratio } : found))
  if (root && root !== layout.root) put(code, { ...layout, root })
}

export function focusPane(code: string, id: string): void {
  const layout = layoutOf(code)
  if (layout.focus !== id) put(code, { ...layout, focus: id })
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
  if (go.to === "task" && leaf.doc) return show({ ...leaf, doc: { kind: "task", task: go.task } })
  return go
}

export function boxes(root: Node): { leaves: { leaf: Leaf; box: Box }[]; gaps: { split: Split; box: Box }[] } {
  const leaves: { leaf: Leaf; box: Box }[] = []
  const gaps: { split: Split; box: Box }[] = []
  const walk = (node: Node, box: Box) => {
    if (node.kind === "leaf") return void leaves.push({ leaf: node, box })
    gaps.push({ split: node, box })
    const row = node.dir === "row"
    const a = row ? { ...box, w: box.w * node.ratio } : { ...box, h: box.h * node.ratio }
    const b = row ? { ...box, x: box.x + a.w, w: box.w - a.w } : { ...box, y: box.y + a.h, h: box.h - a.h }
    walk(node.a, a)
    walk(node.b, b)
  }
  walk(root, WHOLE)
  return { leaves, gaps }
}

export interface Drag {
  page: Page
  label: string
  x: number
  y: number
  target: { code: string; id: string; edge: Edge; box: Box } | null
}

let drag: Drag | null = null
const dragListeners = new Set<() => void>()
const subscribeDrag = (l: () => void) => (dragListeners.add(l), () => void dragListeners.delete(l))

export const useDrag = (): Drag | null => useSyncExternalStore(subscribeDrag, () => drag)

export function setDrag(next: Drag | null): void {
  drag = next
  for (const l of dragListeners) l()
}
