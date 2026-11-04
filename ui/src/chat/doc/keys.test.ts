import { describe, expect, test } from "bun:test"
import type { Node } from "prosemirror-model"
import { EditorState, TextSelection, type Transaction } from "prosemirror-state"

import { blocks, makeBlock } from "~/chat/doc/blocks"
import { dropOwnEmpty } from "~/chat/doc/keys"
import { attrsOf, schema } from "~/chat/doc/schema"

const T = 1_700_000_000_000

function inLast(...list: Node[]): EditorState {
  const s = EditorState.create({ schema, doc: schema.nodes.doc.create(null, list) })
  const last = blocks(s.doc).at(-1)
  if (!last) throw new Error("no block")
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, last.pos + 2)))
}

function backspace(s: EditorState, posted: (block: string) => boolean = () => false): { handled: boolean; next: EditorState } {
  let next = s
  const handled = dropOwnEmpty("jow", posted)(s, (tr: Transaction) => {
    next = s.apply(tr)
  })
  return { handled, next }
}

const sent = (block: Node): Node => block.type.create({ ...block.attrs, sent: "1" }, block.content)

describe("Backspace in the empty line Enter just gave you", () => {
  test("goes back into your unsent line above", () => {
    const { handled, next } = backspace(inLast(makeBlock("text", "jow", T, "draft"), makeBlock("text", "jow", T + 1)))
    expect(handled).toBe(true)
    expect(next.doc.childCount).toBe(1)
    expect(next.selection.$from.index(0)).toBe(0)
  })

  test("does nothing when the line above was sent, so the caret never lands in a line you can't see (T1464)", () => {
    const s = inLast(sent(makeBlock("text", "jow", T, "posted")), makeBlock("text", "jow", T + 1))
    const { handled, next } = backspace(s)
    expect(handled).toBe(true)
    expect(next).toBe(s)
  })

  test("does nothing when the line above is already a message (T1464)", () => {
    const s = inLast(makeBlock("text", "jow", T, "posted"), makeBlock("text", "jow", T + 1))
    const id = attrsOf(s.doc.child(0)).id
    const { handled, next } = backspace(s, (b) => b === id)
    expect(handled).toBe(true)
    expect(next).toBe(s)
  })
})
