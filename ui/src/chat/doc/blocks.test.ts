import { describe, expect, test } from "bun:test"
import { GIVEN_BACK } from "@kiwi/core/doc/blocks.ts"
import type { Node } from "prosemirror-model"
import { EditorState, TextSelection } from "prosemirror-state"

import { atBlockEnd, attach, backInDraft, blockAfter, blockAt, joinBack, joinForward, blocks, continues, dropEmptyOwn, makeBlock, replyIn, startBlock, unreply } from "~/chat/doc/blocks"
import { attrsOf, imageNode, schema } from "~/chat/doc/schema"

const T = 1_700_000_000_000

function stateOf(...list: Node[]): EditorState {
  return EditorState.create({ schema, doc: schema.nodes.doc.create(null, list) })
}

function texts(state: EditorState): string[] {
  return blocks(state.doc).map((b) => `${attrsOf(b.node).author}:${b.node.textContent}`)
}

function sent(block: Node): Node {
  return block.type.create({ ...block.attrs, sent: "1" }, block.content)
}

function back(block: Node): Node {
  return block.type.create({ ...block.attrs, sent: GIVEN_BACK }, block.content)
}

function caretAtEnd(state: EditorState, index: number): EditorState {
  const b = blocks(state.doc)[index]
  if (!b) throw new Error("no block")
  return state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(b.pos + b.node.nodeSize - 1), -1)))
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

  test("your unsent line keeps the caret: starting to write goes to its end, never a new block that would send it (T1464)", () => {
    const s = stateOf(makeBlock("text", "jow", T, "half a"), makeBlock("agent", "atlas", T + 1, "on it"))
    const next = s.apply(startBlock(s, "jow", T + 2))
    expect(texts(next)).toEqual(["jow:half a", "atlas:on it"])
    expect(next.selection.$from.index(0)).toBe(0)
    expect(next.selection.$from.parentOffset).toBe(6)
  })

  test("a sent line, or one already a message, doesn't hold the caret: a new block of yours starts", () => {
    const s = stateOf(sent(makeBlock("text", "jow", T, "done")), makeBlock("text", "maya", T + 1, "hi"))
    expect(texts(s.apply(startBlock(s, "jow", T + 2)))).toEqual(["jow:done", "maya:hi", "jow:"])
    const p = stateOf(makeBlock("text", "jow", T, "done"), makeBlock("text", "maya", T + 1, "hi"))
    const id = attrsOf(p.doc.child(0)).id
    expect(texts(p.apply(startBlock(p, "jow", T + 2, (b) => b === id)))).toEqual(["jow:done", "maya:hi", "jow:"])
  })
})

describe("starting your next line (⌘/Ctrl+Enter)", () => {
  test("a caret before the end isn't at the block's end", () => {
    const s = stateOf(makeBlock("text", "jow", T, "one"))
    const mid = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 3)))
    expect(atBlockEnd(mid)).toBe(false)
  })

  test("an empty last line (from Enter) is dropped and a new block of yours starts", () => {
    let s = caretAtEnd(stateOf(makeBlock("text", "jow", T, "one")), 0)
    s = s.apply(s.tr.split(s.selection.from))
    const next = s.apply(blockAfter(s, "jow", T + 1)!)
    expect(texts(next)).toEqual(["jow:one", "jow:"])
    expect(next.doc.child(0).childCount).toBe(1)
    expect(next.selection.$from.index(0)).toBe(1)
  })

  test("a caret at the end of a code block is at the block's end", () => {
    const code = schema.nodes.block.create({ id: "b", kind: "text", author: "jow", at: T }, schema.nodes.code_block.create(null, schema.text("y")))
    expect(atBlockEnd(caretAtEnd(stateOf(code), 0))).toBe(true)
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

describe("dropping an image into the doc", () => {
  const shot = imageNode({ name: "shot.png", mime: "image/png", ref: { id: "a".repeat(64), key: "k".repeat(43), size: 10 } })
  const kinds = (b: Node | undefined) => (b ? Array.from({ length: b.childCount }, (_, i) => b.child(i).type.name) : [])

  test("lands at the end of your block, with a line after it to keep typing on", () => {
    const s = caretAtEnd(stateOf(makeBlock("text", "jow", T, "look")), 0)
    const next = s.apply(attach(s, "jow", T + 1, [shot])!)
    expect(kinds(next.doc.child(0))).toEqual(["paragraph", "image", "paragraph"])
    expect(next.selection.$from.parent.type.name).toBe("paragraph")
    expect(next.selection.$from.index(1)).toBe(2)
  })

  test("in someone else's block, it starts a block of yours instead of writing into theirs", () => {
    const s = caretAtEnd(stateOf(makeBlock("text", "maya", T, "hi")), 0)
    const next = s.apply(attach(s, "jow", T + 1, [shot])!)
    expect(texts(next)).toEqual(["maya:hi", "jow:[image: shot.png]"])
    expect(kinds(next.doc.child(1))).toEqual(["image", "paragraph"])
  })

  test("dropped while you're in someone else's block, it joins your unsent line instead of sending it early (T1464)", () => {
    const s = caretAtEnd(stateOf(makeBlock("text", "jow", T, "look"), makeBlock("text", "maya", T + 1, "hi")), 1)
    const next = s.apply(attach(s, "jow", T + 2, [shot])!)
    expect(next.doc.childCount).toBe(2)
    expect(kinds(next.doc.child(0))).toEqual(["paragraph", "image", "paragraph"])
    expect(next.selection.$from.index(0)).toBe(0)
  })
})

describe("joining blocks like paragraphs", () => {
  const caretAtStart = (state: EditorState, index: number): EditorState => {
    const b = blocks(state.doc)[index]
    if (!b) throw new Error("no block")
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, b.pos + 2)))
  }

  test("Backspace at the start of your block joins it to your block above, caret at the seam", () => {
    const s = caretAtStart(stateOf(makeBlock("text", "jow", T, "first"), makeBlock("text", "jow", T + 1, "second")), 1)
    const next = s.apply(joinBack(s, "jow")!)
    expect(texts(next)).toEqual(["jow:firstsecond"])
    expect(next.selection.$from.parentOffset).toBe(5)
  })

  test("Delete at the end of your block pulls your next block up into it", () => {
    const s = caretAtEnd(stateOf(makeBlock("text", "jow", T, "first"), makeBlock("text", "jow", T + 1, "second")), 0)
    const next = s.apply(joinForward(s, "jow")!)
    expect(texts(next)).toEqual(["jow:firstsecond"])
    expect(next.selection.$from.parentOffset).toBe(5)
  })

  test("never across authors: someone else's words stay theirs", () => {
    const s = caretAtStart(stateOf(makeBlock("text", "maya", T, "hers"), makeBlock("text", "jow", T + 1, "mine")), 1)
    expect(joinBack(s, "jow")).toBeNull()
    const e = caretAtEnd(stateOf(makeBlock("text", "jow", T, "mine"), makeBlock("text", "maya", T + 1, "hers")), 0)
    expect(joinForward(e, "jow")).toBeNull()
  })

  test("never into a line already posted: it has left the doc for the feed", () => {
    const s = caretAtStart(stateOf(makeBlock("text", "jow", T, "sent"), makeBlock("text", "jow", T + 1, "draft")), 1)
    const sent = attrsOf(s.doc.child(0)).id
    const posted = (block: string) => block === sent
    expect(joinBack(s, "jow", posted)).toBeNull()
    expect(joinForward(caretAtEnd(s, 0), "jow", posted)).toBeNull()
  })

  test("never into a line already sent, even before its message arrives (T1464)", () => {
    const s = caretAtStart(stateOf(sent(makeBlock("text", "jow", T, "sent")), makeBlock("text", "jow", T + 1, "draft")), 1)
    expect(joinBack(s, "jow")).toBeNull()
    expect(joinForward(caretAtEnd(s, 0), "jow")).toBeNull()
  })

  test("only from the very start or end: mid-text and the first block do nothing", () => {
    const s = stateOf(makeBlock("text", "jow", T, "first"), makeBlock("text", "jow", T + 1, "second"))
    const mid = s.apply(s.tr.setSelection(TextSelection.create(s.doc, blocks(s.doc)[1]!.pos + 4)))
    expect(joinBack(mid, "jow")).toBeNull()
    expect(joinBack(caretAtStart(s, 0), "jow")).toBeNull()
  })
})

describe("Reply and Quote on a message land in your draft in the doc (T1402)", () => {
  test("Reply with a draft of yours at the end binds it to that draft and posts nothing", () => {
    const s = caretAtEnd(stateOf(makeBlock("text", "maya", T, "hi"), makeBlock("text", "jow", T + 1, "half writ")), 0)
    const next = s.apply(replyIn(s, "jow", T + 2, 12, null))
    expect(texts(next)).toEqual(["maya:hi", "jow:half writ"])
    expect(attrsOf(next.doc.child(1))).toMatchObject({ re: 12, quote: null })
    expect(next.selection.$from.index(0)).toBe(1)
    expect(next.selection.$from.parentOffset).toBe("half writ".length)
  })

  test("Quote with no draft of yours starts one that carries the quoted lines", () => {
    const s = stateOf(makeBlock("text", "maya", T, "hi"))
    const next = s.apply(replyIn(s, "jow", T + 1, 12, "ship it friday"))
    expect(texts(next)).toEqual(["maya:hi", "jow:"])
    expect(attrsOf(next.doc.child(1))).toMatchObject({ author: "jow", re: 12, quote: "ship it friday" })
    expect(next.selection.$from.index(0)).toBe(1)
  })

  test("Reply binds to your unsent line even with an agent's block after it, instead of a new block that would send it (T1464)", () => {
    const s = stateOf(makeBlock("text", "jow", T, "half writ"), makeBlock("agent", "atlas", T + 1, "on it"))
    const next = s.apply(replyIn(s, "jow", T + 2, 12, "ship it friday"))
    expect(texts(next)).toEqual(["jow:half writ", "atlas:on it"])
    expect(attrsOf(next.doc.child(0))).toMatchObject({ re: 12, quote: "ship it friday" })
    expect(next.selection.$from.index(0)).toBe(0)
  })

  test("someone else's last block gets a new block of yours, not the reply", () => {
    const s = stateOf(makeBlock("text", "maya", T, "hi"))
    const next = s.apply(replyIn(s, "jow", T + 1, 7, null))
    expect(attrsOf(next.doc.child(0)).re).toBeNull()
    expect(attrsOf(next.doc.child(1)).re).toBe(7)
  })

  test("cancelling drops the reply and keeps the words", () => {
    const s = stateOf(makeBlock("text", "jow", T, "agreed"))
    const replied = s.apply(replyIn(s, "jow", T + 1, 12, "ship it"))
    const tr = unreply(replied, attrsOf(replied.doc.child(0)).id)
    if (!tr) throw new Error("no block")
    const next = replied.apply(tr)
    expect(attrsOf(next.doc.child(0))).toMatchObject({ re: null, quote: null })
    expect(texts(next)).toEqual(["jow:agreed"])
  })
})

describe("a line given back to you as a draft (T1678)", () => {
  test("drops your empty blocks after it and puts the caret at its end, so typing goes on in it", () => {
    const line = back(makeBlock("text", "jow", T, "ship it"))
    const s = caretAtEnd(stateOf(line, makeBlock("text", "maya", T + 1, "hers"), makeBlock("text", "jow", T + 2)), 2)
    const tr = backInDraft(s, "jow", attrsOf(line).id)
    if (!tr) throw new Error("no transaction")
    const next = s.apply(tr)
    expect(texts(next)).toEqual(["jow:ship it", "maya:hers"])
    expect(blockAt(next)?.index).toBe(0)
    expect(next.selection.$from.parentOffset).toBe("ship it".length)
  })

  test("leaves the caret in the line you're already typing, and your next start goes there, not back", () => {
    const line = back(makeBlock("text", "jow", T, "ship it"))
    const s = caretAtEnd(stateOf(line, makeBlock("text", "jow", T + 1, "next line")), 1)
    const tr = backInDraft(s, "jow", attrsOf(line).id)
    if (!tr) throw new Error("no transaction")
    const next = s.apply(tr)
    expect(texts(next)).toEqual(["jow:ship it", "jow:next line"])
    expect(blockAt(next)?.index).toBe(1)
    expect(blockAt(next.apply(startBlock(next, "jow", T + 3)))?.index).toBe(1)
  })

  test("starting to write lands in it while only your empty blocks follow it; someone else's line is never yours to give back", () => {
    const line = back(makeBlock("text", "jow", T, "ship it"))
    const s = stateOf(line, makeBlock("text", "maya", T + 1, "hers"), makeBlock("text", "jow", T + 2))
    const next = s.apply(startBlock(s, "jow", T + 3))
    expect(blockAt(next)?.index).toBe(0)
    expect(texts(next)).toEqual(["jow:ship it", "maya:hers", "jow:"])
    expect(backInDraft(s, "maya", attrsOf(line).id)).toBeNull()
  })
})
