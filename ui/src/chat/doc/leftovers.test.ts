import { describe, expect, test } from "bun:test"
import type { Node } from "prosemirror-model"
import { EditorState } from "prosemirror-state"

import { blocks, makeBlock } from "~/chat/doc/blocks"
import { dropLeftovers, LEFTOVER_GRACE_MS, leftovers, liveOf, type Live } from "~/chat/doc/leftovers"
import { thisWindow } from "~/chat/doc/made"
import { attrsOf, schema } from "~/chat/doc/schema"

const T = 1_700_000_000_000
const GRACE = LEFTOVER_GRACE_MS
const nobody: Live = { windows: new Set(), carets: new Set(), unknown: false }
const none = (): boolean => false

const docOf = (...list: Node[]): Node => schema.nodes.doc.create(null, list)
const idOf = (n: Node): string => attrsOf(n).id

function sweep(doc: Node, live: Live, from: number, every = GRACE / 4, times = 6, made = none): string[][] {
  const unheld = new Map<string, number>()
  return Array.from({ length: times }, (_, i) => leftovers(doc, "jow", from + i * every, live, made, unheld))
}

describe("leftover empty lines leave the doc (T3424)", () => {
  test("an empty line a closed window left behind goes, once it has gone unheld for the grace period", () => {
    const old = makeBlock("text", "jow", T, "", "closed-window")
    const doc = docOf(makeBlock("text", "maya", T, "oi"), old)
    const runs = sweep(doc, nobody, T + GRACE)
    expect(runs.slice(0, 4).every((r) => r.length === 0)).toBe(true)
    expect(runs[4]).toEqual([idOf(old)])
  })

  test("a line of a window that is still open stays, however old", () => {
    const line = makeBlock("text", "jow", T, "", "open-window")
    const runs = sweep(docOf(line), { ...nobody, windows: new Set(["open-window"]) }, T + 10 * GRACE)
    expect(runs.flat()).toEqual([])
  })

  test("a line someone's caret is in stays, and the grace period starts over once the caret leaves", () => {
    const line = makeBlock("text", "jow", T, "", "closed-window")
    const doc = docOf(line)
    const unheld = new Map<string, number>()
    const held: Live = { ...nobody, carets: new Set([idOf(line)]) }
    expect(leftovers(doc, "jow", T + 5 * GRACE, held, none, unheld)).toEqual([])
    expect(leftovers(doc, "jow", T + 6 * GRACE, nobody, none, unheld)).toEqual([])
    expect(leftovers(doc, "jow", T + 6 * GRACE + GRACE / 2, nobody, none, unheld)).toEqual([])
    expect(leftovers(doc, "jow", T + 7 * GRACE, held, none, unheld)).toEqual([])
    expect(leftovers(doc, "jow", T + 7 * GRACE + GRACE / 2, nobody, none, unheld)).toEqual([])
    expect(leftovers(doc, "jow", T + 8 * GRACE + GRACE / 2, nobody, none, unheld)).toEqual([idOf(line)])
  })

  test("a line made less than the grace period ago stays even if nobody holds it", () => {
    const line = makeBlock("text", "jow", T, "", "closed-window")
    const runs = sweep(docOf(line), nobody, T, GRACE / 8, 7)
    expect(runs.flat()).toEqual([])
  })

  test("lines with words, other people's lines, this window's lines and the ones it made never go", () => {
    const words = makeBlock("text", "jow", T, "oi", "closed-window")
    const theirs = makeBlock("text", "harry", T, "", "closed-window")
    const here = makeBlock("text", "jow", T, "", thisWindow)
    const madeHere = makeBlock("text", "jow", T, "", "closed-window")
    const doc = docOf(words, theirs, here, madeHere)
    const runs = sweep(doc, nobody, T + GRACE, GRACE / 4, 8, (id) => id === idOf(madeHere))
    expect(runs.flat()).toEqual([])
  })

  test("while a window of yours runs an older UI that doesn't say which window it is, nothing goes", () => {
    const line = makeBlock("text", "jow", T, "", "closed-window")
    const runs = sweep(docOf(line), { ...nobody, unknown: true }, T + 10 * GRACE)
    expect(runs.flat()).toEqual([])
  })
})

describe("who holds a line, from the windows' shared state", () => {
  test("your windows count by their id, anyone's caret holds its line, and a window of yours without an id makes it unknown", () => {
    const live = liveOf(
      [{ kiwi: { author: "jow", window: "w1", selection: { block: "a", text: "" } } }, { kiwi: { author: "harry", window: "h1", selection: { block: "b", text: "" } } }, { user: { name: "bot" } }, {}],
      "jow"
    )
    expect([...live.windows]).toEqual(["w1"])
    expect([...live.carets].sort()).toEqual(["a", "b"])
    expect(live.unknown).toBe(false)
    expect(liveOf([{ kiwi: { author: "jow", selection: null } }], "jow").unknown).toBe(true)
    expect(liveOf([{ kiwi: { author: "harry", selection: null } }], "jow").unknown).toBe(false)
  })
})

describe("taking the leftovers out", () => {
  test("removes only the named empty lines, and never empties the doc", () => {
    const keep = makeBlock("text", "maya", T, "oi")
    const gone = makeBlock("text", "jow", T, "", "closed-window")
    const typed = makeBlock("text", "jow", T, "now with words", "closed-window")
    const state = EditorState.create({ schema, doc: docOf(keep, gone, typed) })
    const tr = dropLeftovers(state, [idOf(gone), idOf(typed)])
    expect(tr && blocks(tr.doc).map((b) => attrsOf(b.node).id)).toEqual([idOf(keep), idOf(typed)])
    const alone = EditorState.create({ schema, doc: docOf(gone) })
    expect(dropLeftovers(alone, [idOf(gone)])).toBeNull()
    expect(dropLeftovers(state, [])).toBeNull()
  })
})
