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
      content: "paragraph+",
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
    paragraph: { content: "text*", parseDOM: [{ tag: "p" }], toDOM: () => ["p", 0] },
    text: {},
  },
  marks: {
    code: { parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
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
