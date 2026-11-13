import { useSyncExternalStore } from "react"

import type { Where } from "~/model"
import { startNav, type Nav, type Panel } from "~/nav"
import type { Tab } from "~/places"

export type Doc = { kind: "task"; task: number } | { kind: "now" } | { kind: "panel"; panel: Panel } | { kind: "blank" } | { kind: "home"; only?: string } | { kind: "activity" }

export const BLANK: Page = { at: "doc", doc: { kind: "blank" } }

export const PANE_DRAG = "application/x-kiwi-pane"

export function homeFrom(raw: string): Page | null {
  if (raw === "home") return { at: "doc", doc: { kind: "home" } }
  const only = /^channel:(.+)$/.exec(raw)?.[1]
  return only ? { at: "doc", doc: { kind: "home", only } } : null
}

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
  typing?: string
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

export const NOWHERE: Where = { kind: "task", task: 0 }
export const ONLY: Leaf = { kind: "leaf", id: MAIN, nav: null }
export const ALONE: Layout = { root: ONLY, focus: MAIN }

const KEY = "mc.panes"
const listeners = new Set<() => void>()
let made = 0

export const nextId = (kind: "pane" | "split"): string => `${kind}-${++made}`

type Kept = Pick<Nav, "where" | "tab" | "spec" | "part" | "github">

const keptOf = (nav: Nav): Kept => ({ where: nav.where, tab: nav.tab, spec: nav.spec, part: nav.part, github: nav.github })

function slim(node: Node): unknown {
  if (node.kind === "split") return { ...node, a: slim(node.a), b: slim(node.b) }
  return { ...node, nav: node.nav ? keptOf(node.nav) : null }
}

function grown(code: string, raw: unknown): Node | null {
  if (!raw || typeof raw !== "object") return null
  const node = raw as { kind?: unknown; id?: unknown; nav?: unknown; doc?: Doc; a?: unknown; b?: unknown }
  if (typeof node.id !== "string") return null
  const n = /^(?:pane|split)-(\d+)$/.exec(node.id)?.[1]
  if (n) made = Math.max(made, Number(n))
  if (node.kind === "split") {
    const a = grown(code, node.a)
    const b = grown(code, node.b)
    return a && b ? { ...(raw as Split), a, b } : null
  }
  if (node.kind !== "leaf") return null
  const nav = node.nav && typeof node.nav === "object" ? { ...startNav(code), ...(node.nav as Kept) } : null
  return { kind: "leaf", id: node.id, nav, ...(node.doc ? { doc: node.doc } : {}) }
}

function load(): Map<string, Layout> {
  const out = new Map<string, Layout>()
  try {
    const got: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    for (const [code, raw] of Object.entries(got as Record<string, { root?: unknown; focus?: unknown; typing?: unknown }>)) {
      const root = grown(code, raw?.root)
      if (root && leafOf(root, MAIN)) out.set(code, { root, focus: typeof raw.focus === "string" ? raw.focus : MAIN, typing: typeof raw.typing === "string" ? raw.typing : MAIN })
    }
  } catch {
    // A damaged or missing saved layout starts every channel from the default one.
  }
  return out
}

let saving = 0
function save(): void {
  window.clearTimeout(saving)
  saving = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([...layouts].map(([code, l]) => [code, { ...l, root: slim(l.root) }]))))
    } catch {
      // Storage is off: the layout lasts until the app restarts.
    }
  }, 300)
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

export const nowLeaf = (code: string): Leaf => ({ kind: "leaf", id: `pane-${++made}`, nav: { ...startNav(code), where: NOWHERE }, doc: { kind: "now" } })

export const isNow = (leaf: Leaf): boolean => leaf.doc?.kind === "now"

export const docked = (code: string, root: Node): Node => ({ kind: "split", id: `split-${++made}`, dir: "row", ratio: 0.7, fix: { side: "b", px: null }, a: root, b: nowLeaf(code) })

export function layoutOf(code: string): Layout {
  const held = layouts.get(code)
  if (held) return held
  const first: Layout = { root: docked(code, ONLY), focus: MAIN }
  layouts.set(code, first)
  return first
}

export function put(code: string, layout: Layout): void {
  layouts.set(code, layout)
  save()
  for (const l of listeners) l()
}

export const useLayout = (code: string): Layout => useSyncExternalStore(subscribe, () => layoutOf(code))

export function findLeaf(node: Node, is: (leaf: Leaf) => boolean): Leaf | null {
  if (node.kind === "leaf") return is(node) ? node : null
  return findLeaf(node.a, is) ?? findLeaf(node.b, is)
}

export const leafOf = (node: Node, id: string): Leaf | null => findLeaf(node, (leaf) => leaf.id === id)

export function swap(node: Node, id: string, to: (found: Node) => Node | null): Node | null {
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

let closer: (() => boolean) | null = null

export function setCloser(next: (() => boolean) | null): void {
  closer = next
}

export const closeFocused = (): boolean => closer?.() ?? false

export interface Drag {
  carry: Carry
  label: string
  x: number
  y: number
  target: { code: string; id: string; edge: Edge; fill?: true; box: { x: number; y: number; w: number; h: number } } | null
}

let drag: Drag | null = null
const dragListeners = new Set<() => void>()
const subscribeDrag = (l: () => void) => (dragListeners.add(l), () => void dragListeners.delete(l))

export const useDrag = (): Drag | null => useSyncExternalStore(subscribeDrag, () => drag)

export function setDrag(next: Drag | null): void {
  drag = next
  for (const l of dragListeners) l()
}

const layouts = load()
