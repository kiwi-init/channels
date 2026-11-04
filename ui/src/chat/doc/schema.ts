import { Schema, type Node } from "prosemirror-model"

export type BlockKind = "text" | "agent" | "tool" | "comment"

const KINDS: readonly BlockKind[] = ["text", "agent", "tool", "comment"]

export interface BlockAttrs {
  id: string
  kind: BlockKind
  author: string
  at: number
}

export const FRAGMENT = "thread"

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    block: {
      content: "(paragraph | code_block | bullet_list | ordered_list)+",
      defining: true,
      isolating: true,
      attrs: { id: { default: "" }, kind: { default: "text" }, author: { default: "" }, at: { default: 0 } },
      parseDOM: [
        {
          tag: "section[data-block]",
          getAttrs: (el) => ({ id: el.dataset.block ?? "", kind: kindOf(el.dataset.kind), author: el.dataset.author ?? "", at: Number(el.dataset.at) || 0 }),
        },
      ],
      toDOM: (node) => ["section", { "data-block": attrsOf(node).id, "data-kind": attrsOf(node).kind, "data-author": attrsOf(node).author, "data-at": String(attrsOf(node).at) }, 0],
    },
    paragraph: { content: "inline*", parseDOM: [{ tag: "p" }], toDOM: () => ["p", 0] },
    mention: {
      inline: true,
      group: "inline",
      atom: true,
      selectable: false,
      attrs: { name: { default: "" } },
      parseDOM: [{ tag: "span[data-mention]", getAttrs: (el) => ({ name: el.dataset.mention ?? "" }) }],
      toDOM: (node) => ["span", { "data-mention": String(node.attrs.name), class: "doc-mention" }, `@${String(node.attrs.name)}`],
      leafText: (node) => `@${String(node.attrs.name)}`,
    },
    code_block: {
      content: "text*",
      marks: "",
      code: true,
      defining: true,
      parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
      toDOM: () => ["pre", ["code", 0]],
    },
    bullet_list: { content: "list_item+", parseDOM: [{ tag: "ul" }], toDOM: () => ["ul", 0] },
    ordered_list: {
      content: "list_item+",
      attrs: { order: { default: 1 } },
      parseDOM: [{ tag: "ol", getAttrs: (el) => ({ order: Number(el.getAttribute("start")) || 1 }) }],
      toDOM: (node) => ["ol", node.attrs.order === 1 ? {} : { start: String(node.attrs.order) }, 0],
    },
    list_item: { content: "paragraph (bullet_list | ordered_list)*", defining: true, parseDOM: [{ tag: "li" }], toDOM: () => ["li", 0] },
    text: { group: "inline" },
  },
  marks: {
    strong: { parseDOM: [{ tag: "strong" }, { tag: "b" }], toDOM: () => ["strong", 0] },
    em: { parseDOM: [{ tag: "em" }, { tag: "i" }], toDOM: () => ["em", 0] },
    strike: { parseDOM: [{ tag: "s" }, { tag: "del" }], toDOM: () => ["s", 0] },
    code: { excludes: "_", parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
  },
})

function kindOf(value: unknown): BlockKind {
  return KINDS.find((k) => k === value) ?? "text"
}

export function attrsOf(node: Node): BlockAttrs {
  const a = node.attrs
  return { id: String(a.id ?? ""), kind: kindOf(a.kind), author: String(a.author ?? ""), at: Number(a.at) || 0 }
}

export function newBlockId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}
