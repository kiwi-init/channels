import { describe, expect, test } from "bun:test"
import type { Node } from "prosemirror-model"
import { EditorState, TextSelection } from "prosemirror-state"

import { blockAfter, blocks, continues, dropEmptyOwn, finishesBlock, makeBlock, startBlock } from "~/chat/doc/blocks"
import { attrsOf, schema } from "~/chat/doc/schema"

const T = 1_700_000_000_000

function stateOf(...list: Node[]): EditorState {
  return EditorState.create({ schema, doc: schema.nodes.doc.create(null, list) })
}

function texts(state: EditorState): string[] {
  return blocks(state.doc).map((b) => `${attrsOf(b.node).author}:${b.node.textContent}`)
}

function caretAtEnd(state: EditorState, index: number): EditorState {
  const b = blocks(state.doc)[index]
  if (!b) throw new Error("no block")
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, b.pos + b.node.nodeSize - 2)))
}

describe("starting to write in a thread", () => {
  test("adds a block of yours at the end and puts the caret in it", () => {
    const s = stateOf(makeBlock("text", "maya", T, "hi"))
    const next = s.apply(startBlock(s, "jow", T + 1))
    expect(texts(next)).toEqual(["maya:hi", "jow:"])
    expect(next.selection.$from.index(0)).toBe(1)
  })

  test("takes over the empty block a new doc starts with", () => {
    const s = stateOf(schema.nodes.doc.createAndFill()!.child(0))
    const next = s.apply(startBlock(s, "jow", T))
    expect(texts(next)).toEqual(["jow:"])
    expect(attrsOf(next.doc.child(0)).id).toHaveLength(22)
  })

  test("reuses your own empty block at the end instead of adding another", () => {
    const s = stateOf(makeBlock("text", "maya", T, "hi"), makeBlock("text", "jow", T))
    const next = s.apply(startBlock(s, "jow", T + 1))
    expect(next.doc.childCount).toBe(2)
  })

  test("never writes into someone else's empty block", () => {
    const s = stateOf(makeBlock("text", "maya", T))
    const next = s.apply(startBlock(s, "jow", T))
    expect(texts(next)).toEqual(["maya:", "jow:"])
  })
})

describe("finishing a block", () => {
  test("Enter on an empty last line ends the block and starts a new one of yours", () => {
    let s = stateOf(makeBlock("text", "jow", T, "one"))
    s = caretAtEnd(s, 0)
    s = s.apply(s.tr.split(s.selection.from))
    expect(finishesBlock(s)).toBe(true)
    const next = s.apply(blockAfter(s, "jow", T + 1)!)
    expect(texts(next)).toEqual(["jow:one", "jow:"])
    expect(next.doc.child(0).childCount).toBe(1)
    expect(next.selection.$from.index(0)).toBe(1)
  })

  test("a line with text, or the only line, doesn't end the block", () => {
    expect(finishesBlock(caretAtEnd(stateOf(makeBlock("text", "jow", T, "one")), 0))).toBe(false)
    expect(finishesBlock(caretAtEnd(stateOf(makeBlock("text", "jow", T)), 0))).toBe(false)
  })

  test("a new block goes right after the one you're in, not at the end", () => {
    const s = caretAtEnd(stateOf(makeBlock("text", "maya", T, "a"), makeBlock("text", "win", T, "b")), 0)
    expect(texts(s.apply(blockAfter(s, "jow", T)!))).toEqual(["maya:a", "jow:", "win:b"])
  })

  test("doesn't go into anyone's undo history", () => {
    const s = caretAtEnd(stateOf(makeBlock("text", "jow", T, "a")), 0)
    expect(blockAfter(s, "jow", T)?.getMeta("addToHistory")).toBe(false)
    expect(startBlock(s, "jow", T).getMeta("addToHistory")).toBe(false)
  })
})

describe("tidying", () => {
  test("drops your empty blocks except the one you're in, and leaves others' alone", () => {
    const s = stateOf(makeBlock("text", "jow", T), makeBlock("text", "maya", T), makeBlock("text", "jow", T, "kept"), makeBlock("text", "jow", T))
    const next = s.apply(dropEmptyOwn(s, "jow", 3)!)
    expect(texts(next)).toEqual(["maya:", "jow:kept", "jow:"])
  })

  test("keeps the last block a doc must have", () => {
    expect(dropEmptyOwn(stateOf(makeBlock("text", "jow", T)), "jow", null)).toBeNull()
  })
})

describe("a run of blocks", () => {
  test("continues when the same author writes the same kind within five minutes", () => {
    const a = makeBlock("text", "jow", T, "a")
    expect(continues(a, makeBlock("text", "jow", T + 60_000, "b"))).toBe(true)
    expect(continues(a, makeBlock("agent", "jow", T + 60_000, "b"))).toBe(false)
    expect(continues(a, makeBlock("text", "maya", T + 60_000, "b"))).toBe(false)
    expect(continues(a, makeBlock("text", "jow", T + 6 * 60_000, "b"))).toBe(false)
    expect(continues(undefined, a)).toBe(false)
  })
})
