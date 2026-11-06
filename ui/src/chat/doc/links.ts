import { sanitizeMarkdownUrl } from "@kiwi/app/markdown.ts"
import type { Node } from "prosemirror-model"
import { Plugin, PluginKey } from "prosemirror-state"
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view"

import { openOutside } from "~/kit/outside"

export interface DocLink {
  from: number
  to: number
  href: string
  label: { from: number; to: number }
}

const MARKDOWN = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)\)/gi
const BARE = /\bhttps?:\/\/[^\s<>"'`]+/gi
const TRAIL = /[.,;:!?'"*_~]+$/

function trimUrl(url: string): string {
  let out = url.replace(TRAIL, "")
  while (out.endsWith(")") && (out.match(/\(/g)?.length ?? 0) < (out.match(/\)/g)?.length ?? 0)) out = out.slice(0, -1).replace(TRAIL, "")
  return out
}

function codeSpans(block: Node): (readonly [number, number])[] {
  const spans: (readonly [number, number])[] = []
  block.forEach((child, offset) => {
    if (child.isText && child.marks.some((m) => m.type.name === "code")) spans.push([offset, offset + child.nodeSize])
  })
  return spans
}

const safe = (href: string): boolean => !!sanitizeMarkdownUrl(href)

type Found = { href: string; at: readonly [number, number, number, number] }

const cache = new WeakMap<Node, Found[]>()

function linksOfBlock(block: Node): Found[] {
  const hit = cache.get(block)
  if (hit) return hit
  const text = block.textBetween(0, block.content.size, undefined, "\uFFFC")
  const code = codeSpans(block)
  const overlaps = (spans: readonly (readonly [number, number])[], from: number, to: number): boolean => spans.some(([a, b]) => from < b && to > a)
  const found: Found[] = []
  for (const m of text.matchAll(MARKDOWN)) {
    const from = m.index
    const to = from + m[0].length
    const href = m[2] ?? ""
    const label = m[1] ?? ""
    if (overlaps(code, from, to) || !safe(href)) continue
    found.push({ href, at: [from, to, from + 1, from + 1 + label.length] })
  }
  const taken = found.map((f) => [f.at[0], f.at[1]] as const)
  for (const m of text.matchAll(BARE)) {
    const from = m.index
    const href = trimUrl(m[0])
    const to = from + href.length
    if (overlaps(taken, from, to) || overlaps(code, from, to) || !safe(href)) continue
    found.push({ href, at: [from, to, from, to] })
  }
  found.sort((a, b) => a.at[0] - b.at[0])
  cache.set(block, found)
  return found
}

export function linksIn(doc: Node): DocLink[] {
  const out: DocLink[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (node.type.spec.code) return false
    const start = pos + 1
    for (const { href, at } of linksOfBlock(node)) out.push({ href, from: start + at[0], to: start + at[1], label: { from: start + at[2], to: start + at[3] } })
    return false
  })
  return out
}

export interface LinkPart {
  from: number
  to: number
  href: string
  part: "label" | "syntax"
  folded: boolean
}

export function openLink(links: readonly DocLink[], sel: { from: number; to: number }): number {
  return links.findIndex((l) => sel.from <= l.to && sel.to >= l.from)
}

export function linkParts(links: readonly DocLink[], open: number): LinkPart[] {
  return links.flatMap((l, i) => {
    const label: LinkPart = { from: l.label.from, to: l.label.to, href: l.href, part: "label", folded: false }
    if (l.label.from === l.from) return [label]
    const folded = i !== open
    return [{ from: l.from, to: l.label.from, href: l.href, part: "syntax" as const, folded }, label, { from: l.label.to, to: l.to, href: l.href, part: "syntax" as const, folded }]
  })
}

function paint(doc: Node, links: readonly DocLink[], open: number): DecorationSet {
  return DecorationSet.create(
    doc,
    linkParts(links, open).map((p) =>
      p.part === "label"
        ? Decoration.inline(p.from, p.to, { nodeName: "a", href: p.href, class: "doc-link", title: p.href, rel: "noopener noreferrer" })
        : Decoration.inline(p.from, p.to, { class: p.folded ? "doc-link-md is-folded" : "doc-link-md" })
    )
  )
}

interface LinkState {
  links: DocLink[]
  open: number
  set: DecorationSet
}

const key = new PluginKey<LinkState>("doc-links")

function linkAt(target: EventTarget | null): string | null {
  const a = target instanceof Element ? target.closest<HTMLAnchorElement>("a.doc-link") : null
  return a?.getAttribute("href") ?? null
}

function opensOnPlainClick(view: EditorView, target: Element): boolean {
  if (!view.editable) return true
  const block = target.closest(".blk")
  return !!block && !block.classList.contains("is-mine")
}

export function linksPlugin(open: (url: string) => void = openOutside): Plugin<LinkState> {
  return new Plugin<LinkState>({
    key,
    state: {
      init: (_, state) => {
        const links = linksIn(state.doc)
        const at = openLink(links, state.selection)
        return { links, open: at, set: paint(state.doc, links, at) }
      },
      apply: (tr, was, _old, state) => {
        const links = tr.docChanged ? linksIn(state.doc) : was.links
        const at = openLink(links, state.selection)
        if (!tr.docChanged && at === was.open) return was
        return { links, open: at, set: paint(state.doc, links, at) }
      },
    },
    props: {
      decorations: (state) => key.getState(state)?.set ?? null,
      handleDOMEvents: {
        click: (view, e) => {
          const href = linkAt(e.target)
          if (!href || !(e.target instanceof Element)) return false
          e.preventDefault()
          if (!(e.metaKey || e.ctrlKey) && !opensOnPlainClick(view, e.target)) return false
          open(href)
          return true
        },
        mousemove: (view, e) => {
          view.dom.classList.toggle("is-mod", e.metaKey || e.ctrlKey)
          return false
        },
        mouseleave: (view) => {
          view.dom.classList.remove("is-mod")
          return false
        },
        auxclick: (_view, e) => {
          if (linkAt(e.target)) e.preventDefault()
          return false
        },
      },
    },
  })
}
