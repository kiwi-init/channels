import { describe, expect, test } from "bun:test"
import type { Node } from "prosemirror-model"
import { EditorState, TextSelection, type Transaction } from "prosemirror-state"

import { blocks, makeBlock } from "~/chat/doc/blocks"
import { dropOwnEmpty, wordIntoNext } from "~/chat/doc/keys"
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

describe("word select at a line's end reaches into the next line, as Linux WebKit doesn't across the author header (T3618)", () => {
  const at = (list: Node[], block: number, offset: number): EditorState => {
    const s = EditorState.create({ schema, doc: schema.nodes.doc.create(null, list) })
    const b = blocks(s.doc)[block]
    if (!b) throw new Error("no block")
    return s.apply(s.tr.setSelection(TextSelection.create(s.doc, b.pos + 2 + offset)))
  }
  const press = (s: EditorState): { handled: boolean; next: EditorState } => {
    let next = s
    const handled = wordIntoNext(s, (tr: Transaction) => {
      next = s.apply(tr)
    })
    return { handled, next }
  }

  test("from the end of a line, the selection runs to the end of the next line's first word", () => {
    const s = at([makeBlock("text", "jow", T, "first line"), makeBlock("text", "lead", T + 1, "  next words here")], 0, "first line".length)
    const { handled, next } = press(s)
    expect(handled).toBe(true)
    expect(next.selection.anchor).toBe(s.selection.anchor)
    expect(next.selection.$head.index(0)).toBe(1)
    expect(next.doc.textBetween(next.selection.from, next.selection.to, "|")).toBe("|  next")
  })

  test("in the middle of a line or in the last line, the browser keeps the key", () => {
    expect(press(at([makeBlock("text", "jow", T, "first line"), makeBlock("text", "lead", T + 1, "next")], 0, 3)).handled).toBe(false)
    expect(press(at([makeBlock("text", "jow", T, "first line"), makeBlock("text", "lead", T + 1, "next")], 1, 4)).handled).toBe(false)
  })
})
