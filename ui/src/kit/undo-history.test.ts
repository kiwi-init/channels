import { describe, expect, test } from "bun:test"

import { historyKey } from "~/kit/undo"
import { edited, fresh, PAUSE_MS, redone, settled, synced, undone, type History, type Snap } from "~/kit/undo-history"

const at = (value: string, caret = value.length): Snap => ({ value, start: caret, end: caret })

function typed(h: History, text: string, from = 0): History {
  let now = h
  let clock = from
  for (const ch of text) {
    clock += 50
    now = edited(synced(now, now.now), { type: ch === "\n" ? "insertLineBreak" : "insertText", data: ch === "\n" ? null : ch, at: clock })
    now = settled(now, at(now.now.value + ch))
  }
  return now
}

function deleted(h: History, count: number, from = 0): History {
  let now = h
  for (let i = 0; i < count; i++) {
    now = edited(synced(now, now.now), { type: "deleteContentBackward", data: null, at: from + i * 50 })
    now = settled(now, at(now.now.value.slice(0, -1)))
  }
  return now
}

function pasted(h: History, text: string, clock: number): History {
  const now = edited(synced(h, h.now), { type: "insertFromPaste", data: text, at: clock })
  return settled(now, at(now.now.value + text))
}

const undo = (h: History): History => undone(synced(h, h.now))?.history ?? h
const redo = (h: History): History => redone(synced(h, h.now))?.history ?? h
const text = (h: History): string => h.now.value

describe("undo history steps", () => {
  test("typing undoes a word at a time, and redo walks back up", () => {
    const h = typed(fresh(at("")), "hello big world")
    expect(text(h)).toBe("hello big world")
    expect(text(undo(h))).toBe("hello big ")
    expect(text(undo(undo(h)))).toBe("hello ")
    expect(text(undo(undo(undo(h))))).toBe("")
    expect(text(redo(undo(undo(h))))).toBe("hello big ")
    expect(text(redo(redo(undo(undo(h)))))).toBe("hello big world")
  })

  test("a pause in typing starts a new step", () => {
    const first = typed(fresh(at("")), "abc")
    const h = typed(first, "def", first.at + PAUSE_MS + 1)
    expect(text(undo(h))).toBe("abc")
  })

  test("a paste is one step of its own, between typed words", () => {
    const h = typed(pasted(typed(fresh(at("")), "see "), "a long pasted line", 10_000), "!", 20_000)
    expect(text(undo(h))).toBe("see a long pasted line")
    expect(text(undo(undo(h)))).toBe("see ")
  })

  test("deleting is a step apart from the typing before it", () => {
    const h = deleted(typed(fresh(at("")), "hello"), 2, 5_000)
    expect(text(h)).toBe("hel")
    expect(text(undo(h))).toBe("hello")
    expect(text(undo(undo(h)))).toBe("")
  })

  test("moving the caret ends the step being typed", () => {
    const h = typed(fresh(at("")), "ab")
    const moved = synced(h, at("ab", 0))
    const more = settled(edited(moved, { type: "insertText", data: "x", at: 200 }), at("xab", 1))
    expect(text(undo(more))).toBe("ab")
  })

  test("one undo is exactly one step, and an empty history does nothing", () => {
    const h = typed(fresh(at("")), "one two")
    expect(text(undo(h))).toBe("one ")
    expect(undone(fresh(at("kept")))).toBeNull()
    expect(redone(h)).toBeNull()
  })

  test("a new edit after an undo drops the redo branch", () => {
    const back = undo(typed(fresh(at("")), "one two"))
    const branched = typed(back, "three", 10_000)
    expect(text(branched)).toBe("one three")
    expect(redone(branched)).toBeNull()
    expect(text(undo(branched))).toBe("one ")
  })

  test("redo right after an undo restores the same text and caret", () => {
    const h = typed(fresh(at("")), "alpha beta")
    const back = undone(h)
    expect(back?.to.value).toBe("alpha ")
    const forward = back && redone(back.history)
    expect(forward?.to).toEqual(at("alpha beta"))
  })
})

describe("text set by code", () => {
  test("a completion is a step, and undo goes back to what was typed before it", () => {
    const typedAt = typed(fresh(at("")), "hi @ma")
    const completed = synced(typedAt, at("hi @maya "))
    const h = typed(completed, "how", 10_000)
    expect(text(h)).toBe("hi @maya how")
    expect(text(undo(h))).toBe("hi @maya ")
    expect(text(undo(undo(h)))).toBe("hi @ma")
  })

  test("undo right after a completion, with nothing typed after it, returns to the typed text", () => {
    const completed = synced(typed(fresh(at("")), "hi @ma"), at("hi @maya "))
    expect(text(undo(completed))).toBe("hi @ma")
  })

  test("a box emptied by code, as a send does, starts a fresh history", () => {
    const sent = synced(typed(fresh(at("")), "first message"), at(""))
    expect(undone(sent)).toBeNull()
    const h = typed(sent, "second", 10_000)
    expect(text(undo(h))).toBe("")
    expect(text(undo(undo(h)))).toBe("")
  })

  test("emptying by hand stays undoable", () => {
    const h = deleted(typed(fresh(at("")), "abc"), 3, 5_000)
    expect(text(h)).toBe("")
    expect(text(undo(h))).toBe("abc")
  })
})

const key = (k: Partial<Parameters<typeof historyKey>[0]>) => ({ key: "", code: "", altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...k })

describe("history keys", () => {
  test("Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo, off macOS", () => {
    expect(historyKey(key({ key: "z", code: "KeyZ", ctrlKey: true }), false)).toBe("undo")
    expect(historyKey(key({ key: "Z", code: "KeyZ", ctrlKey: true, shiftKey: true }), false)).toBe("redo")
    expect(historyKey(key({ key: "y", code: "KeyY", ctrlKey: true }), false)).toBe("redo")
    expect(historyKey(key({ key: "z", code: "KeyZ", metaKey: true }), false)).toBeNull()
  })

  test("Cmd+Z and Cmd+Shift+Z on macOS, where Ctrl+Z and Ctrl+Y are not history keys", () => {
    expect(historyKey(key({ key: "z", code: "KeyZ", metaKey: true }), true)).toBe("undo")
    expect(historyKey(key({ key: "Z", code: "KeyZ", metaKey: true, shiftKey: true }), true)).toBe("redo")
    expect(historyKey(key({ key: "z", code: "KeyZ", ctrlKey: true }), true)).toBeNull()
    expect(historyKey(key({ key: "y", code: "KeyY", ctrlKey: true }), true)).toBeNull()
  })

  test("a non-Latin layout still undoes on the Z key, and Alt or an open composition never does", () => {
    expect(historyKey(key({ key: "я", code: "KeyZ", ctrlKey: true }), false)).toBe("undo")
    expect(historyKey(key({ key: "z", code: "KeyZ", ctrlKey: true, altKey: true }), false)).toBeNull()
    expect(historyKey(key({ key: "z", code: "KeyZ", ctrlKey: true, isComposing: true }), false)).toBeNull()
  })
})
