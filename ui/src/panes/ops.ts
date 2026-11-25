import type { Where } from "~/model"
import { navigate, sameWhere, startNav, type Go, type Nav, type Panel } from "~/nav"
import {
  docked,
  dockedNow,
  findLeaf,
  isNow,
  layoutOf,
  leafOf,
  MAIN,
  nextId,
  nowLeaf,
  NOWHERE,
  ONLY,
  allLayouts,
  KEY,
  setLayout,
  type Kept,
  type Layout,
  swap,
  composes,
  type Box,
  type Carry,
  type Doc,
  type Edge,
  type Leaf,
  type Len,
  type Node,
  type Page,
  type Split,
} from "~/panes/store"
import { note, type By, type Note, type Step } from "~/panes/history"

const keptOf = (nav: Nav): Kept => ({ where: nav.where, tab: nav.tab, spec: nav.spec, part: nav.part, github: nav.github })

function slim(node: Node): unknown {
  if (node.kind === "split") return { ...node, a: slim(node.a), b: slim(node.b) }
  return { ...node, nav: node.nav ? keptOf(node.nav) : null }
}

let saving = 0
function save(): void {
  window.clearTimeout(saving)
  saving = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([...allLayouts()].map(([code, l]) => [code, { ...l, root: slim(l.root) }]))))
    } catch {
      // Storage is off: the layout lasts until the app restarts.
    }
  }, 300)
}

let by: By = "hand"

function asApp(run: () => void): void {
  const was = by
  by = "app"
  try {
    run()
  } finally {
    by = was
  }
}

function whatOf(leaf: Leaf | null): string {
  if (!leaf) return "split"
  const doc = leaf.doc
  if (doc) return doc.kind === "panel" ? `panel:${doc.panel.kind}` : doc.kind
  const nav = leaf.nav
  if (!nav) return "main"
  return nav.tab === "chat" ? nav.where.kind : `tab:${nav.tab}`
}

function spots(code: string, root: Node): Pick<Step, "screen" | "panes"> {
  const host = document.querySelector<HTMLElement>(`[data-panes="${CSS.escape(code)}"]`)
  const r = host?.getBoundingClientRect()
  const w = r?.width || 1
  const h = r?.height || 1
  const side = host?.querySelector<HTMLElement>(".panes-probe")?.offsetWidth ?? 0
  const f = (n: number) => Math.round(n * 100) / 100
  return {
    screen: { w: Math.round(r?.width ?? 0), h: Math.round(r?.height ?? 0) },
    panes: boxes(root).leaves.map(({ leaf, box }) => ({
      pane: leaf.id,
      what: whatOf(leaf),
      x: f(pixels(box.x, w, side) / w),
      y: f(pixels(box.y, h, side) / h),
      w: f(pixels(box.w, w, side) / w),
      h: f(pixels(box.h, h, side) / h),
    })),
  }
}

function put(code: string, layout: Layout, step?: Note): void {
  setLayout(code, layout)
  save()
  if (step) note({ ...step, at: Date.now(), code, by, ...spots(code, layout.root) })
}

const isBlank = (leaf: Leaf): boolean => leaf.doc?.kind === "blank"

const HALF_GAP = 3
const NONE: Len = { p: 0, px: 0, side: 0 }
const ALL: Len = { p: 1, px: 0, side: 0 }
const plus = (a: Len, b: Len): Len => ({ p: a.p + b.p, px: a.px + b.px, side: a.side + b.side })
const times = (a: Len, k: number): Len => ({ p: a.p * k, px: a.px * k, side: a.side * k })

export const isNone = (l: Len): boolean => l.p === 0 && l.px === 0 && l.side === 0
export const css = (l: Len): string => `calc(${l.p * 100}% + ${l.px}px + ${l.side} * var(--side-w))`
export const pixels = (l: Len, whole: number, side: number): number => l.p * whole + l.px + l.side * side

export const without = (root: Node, id: string): Node => swap(root, id, () => null) ?? ONLY

function fresh(code: string, page: Page): Leaf {
  const base = startNav(code)
  const id = nextId("pane")
  if (page.at === "where") return { kind: "leaf", id, nav: { ...base, where: page.where } }
  if (page.at === "tab") return { kind: "leaf", id, nav: { ...base, tab: page.tab } }
  if (page.at === "spec") return { kind: "leaf", id, nav: { ...base, tab: "specs", spec: page.ask, part: "spec" } }
  if (page.doc.kind === "now") return nowLeaf(code)
  return { kind: "leaf", id, nav: { ...base, where: page.doc.kind === "task" ? { kind: "task", task: page.doc.task } : NOWHERE }, doc: page.doc }
}

const beside = (edge: Edge, leaf: Leaf, found: Node): Split => {
  const first = edge === "left" || edge === "top"
  return { kind: "split", id: nextId("split"), dir: edge === "left" || edge === "right" ? "row" : "column", ratio: 0.5, a: first ? leaf : found, b: first ? found : leaf }
}

export function splitAt(code: string, target: string, edge: Edge, page: Page): void {
  const layout = layoutOf(code)
  const now = page.at === "doc" && page.doc.kind === "now" ? findLeaf(layout.root, isNow) : null
  if (now) return now.id === target ? focusPane(code, now.id) : movePane(code, now.id, target, edge)
  const leaf = fresh(code, page)
  const root = swap(layout.root, target, (found) => beside(edge, leaf, found))
  if (root && root !== layout.root) put(code, { ...layout, root, focus: leaf.id }, { act: "open", pane: leaf.id, what: whatOf(leaf), target: whatOf(leafOf(layout.root, target)), edge })
}

export function fillPane(code: string, target: string, carry: Carry): void {
  const layout = layoutOf(code)
  const blank = leafOf(layout.root, target)
  if (!blank || !isBlank(blank)) return
  const moved = "pane" in carry ? leafOf(layout.root, carry.pane) : null
  const now = "page" in carry && carry.page.at === "doc" && carry.page.doc.kind === "now" ? findLeaf(layout.root, isNow) : null
  const into = moved ?? now
  if (into) {
    if (into.id === target) return
    const root = swap(without(layout.root, into.id), target, () => into)
    if (root) put(code, { ...layout, root, focus: into.id }, { act: "move", pane: into.id, what: whatOf(into), target: "blank", edge: "fill" })
    return
  }
  if (!("page" in carry)) return
  const leaf = { ...fresh(code, carry.page), id: target }
  const root = swap(layout.root, target, () => leaf)
  if (root) put(code, { ...layout, root, focus: target }, { act: "open", pane: target, what: whatOf(leaf), target: "blank", edge: "fill" })
}

export function movePane(code: string, id: string, target: string, edge: Edge): void {
  const layout = layoutOf(code)
  const leaf = leafOf(layout.root, id)
  if (!leaf || id === target || !leafOf(layout.root, target)) return
  const root = swap(without(layout.root, id), target, (found) => beside(edge, leaf, found))
  if (root) put(code, { ...layout, root, focus: id }, { act: "move", pane: id, what: whatOf(leaf), target: whatOf(leafOf(layout.root, target)), edge })
}

export function closePane(code: string, id: string): void {
  const layout = layoutOf(code)
  if (id === MAIN || !leafOf(layout.root, id)) return
  const top = layout.root
  const borrowed = top.kind === "split" && top.fix?.side === "b" && top.b.kind === "leaf" && top.b.id === id && !isNow(top.b)
  const root = borrowed ? { ...top, b: nowLeaf(code) } : without(top, id)
  put(code, { root, focus: layout.focus === id ? MAIN : layout.focus, typing: layout.typing === id ? MAIN : layout.typing }, { act: "close", pane: id, what: whatOf(leafOf(top, id)) })
}

export function resizeSplit(code: string, id: string, size: { ratio: number } | { px: number }): void {
  const layout = layoutOf(code)
  const root = swap(layout.root, id, (found) => {
    if (found.kind !== "split") return found
    return "px" in size && found.fix ? { ...found, fix: { ...found.fix, px: size.px } } : "ratio" in size ? { ...found, ratio: size.ratio } : found
  })
  if (root && root !== layout.root) put(code, { ...layout, root }, { act: "resize", pane: id, what: "split" })
}

const talks = (leaf: Leaf): boolean => !leaf.nav || (leaf.nav.tab === "chat" && composes(leaf.doc))

export function focusPane(code: string, id: string, moveTyping = true): void {
  const layout = layoutOf(code)
  const leaf = leafOf(layout.root, id)
  const typing = moveTyping && leaf && talks(leaf) ? id : layout.typing
  if (layout.focus !== id || layout.typing !== typing) put(code, { ...layout, focus: id, typing })
}

export const panelGo = (...args: Parameters<typeof placePanel>): void => asApp(() => placePanel(...args))

function placePanel(code: string, from: string, panel: Panel | null, room?: { id: string; edge: Edge }): void {
  const layout = layoutOf(code)
  const here = leafOf(layout.root, from)
  if (!panel) {
    if (here?.doc?.kind === "panel") closePane(code, from)
    return
  }
  const doc: Doc = { kind: "panel", panel }
  const held = here?.doc?.kind === "panel" ? here : findLeaf(layout.root, (leaf) => leaf.doc?.kind === "panel")
  if (held?.nav) {
    const next = { ...held, doc }
    const root = swap(layout.root, held.id, () => next)
    if (root) put(code, { ...layout, root, focus: held.id }, { act: "replace", pane: held.id, what: whatOf(next), target: whatOf(held) })
    return
  }
  if (room && leafOf(layout.root, room.id)) return splitAt(code, room.id, room.edge, { at: "doc", doc })
  splitAt(code, dockedNow(layout.root)?.id === from || !here ? MAIN : from, "right", { at: "doc", doc })
}

export const showDoc = (...args: Parameters<typeof placeDoc>): void => asApp(() => placeDoc(...args))

function placeDoc(code: string, id: string | null, doc: Doc, shown: boolean, room?: { id: string; edge: Edge }): void {
  const layout = layoutOf(code)
  const here = id ? leafOf(layout.root, id) : null
  if (doc.kind === "activity") {
    const open = findLeaf(layout.root, (leaf) => leaf.doc?.kind === doc.kind)
    if (open) return focusPane(code, open.id)
    if (here && isBlank(here)) return fillPane(code, here.id, { page: { at: "doc", doc } })
    const blank = findLeaf(layout.root, isBlank)
    if (blank) return fillPane(code, blank.id, { page: { at: "doc", doc } })
    const at = room && leafOf(layout.root, room.id) ? room : { id: here?.id ?? MAIN, edge: "right" as const }
    return splitAt(code, at.id, at.edge, { at: "doc", doc })
  }
  const other = doc.kind === "now" ? findLeaf(layout.root, isNow) : null
  if (other && other.id !== here?.id) return shown ? focusPane(code, other.id) : movePane(code, other.id, MAIN, "right")
  if (here?.nav) {
    const where: Where = doc.kind === "task" ? { kind: "task", task: doc.task } : NOWHERE
    const next: Leaf = { ...here, nav: { ...here.nav, tab: "chat", where }, doc }
    const root = swap(layout.root, here.id, () => next)
    if (root) put(code, { ...layout, root }, { act: "replace", pane: here.id, what: whatOf(next), target: whatOf(here) })
    return
  }
  if (doc.kind !== "now") return splitAt(code, MAIN, "right", { at: "doc", doc })
  const now = findLeaf(layout.root, isNow)
  if (!now) {
    const root = docked(code, layout.root)
    const dock = dockedNow(root)
    return put(code, { ...layout, root, focus: dock?.id ?? MAIN }, { act: "open", pane: dock?.id ?? MAIN, what: "now", target: whatOf(leafOf(layout.root, MAIN)), edge: "right" })
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
    const fixed: Len | null = node.fix ? (node.fix.px === null ? { p: 0, px: HALF_GAP, side: 1 } : { p: 0, px: node.fix.px, side: 0 }) : null
    const first = !fixed ? times(size, node.ratio) : node.fix?.side === "a" ? fixed : plus(size, times(fixed, -1))
    const rest = plus(size, times(first, -1))
    gaps.push({ split: node, box, at: plus(row ? box.x : box.y, first) })
    walk(node.a, row ? { ...box, w: first } : { ...box, h: first })
    walk(node.b, row ? { ...box, x: plus(box.x, first), w: rest } : { ...box, y: plus(box.y, first), h: rest })
  }
  walk(root, { x: NONE, y: NONE, w: ALL, h: ALL })
  return { leaves, gaps }
}
