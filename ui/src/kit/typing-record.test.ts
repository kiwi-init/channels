import { describe, expect, test } from "bun:test"

import { dataShape, keyName, TypingRecord } from "~/kit/typing-record"

describe("the typing trace (T1776)", () => {
  test("flags the line getting shorter without a delete key, with what happened just before", () => {
    const r = new TypingRecord()
    r.push({ t: 0, what: "key", key: keyName("o"), block: "b1", before: 3 })
    r.seen(1, "b1", 4)
    r.push({ t: 200, what: "doc changed", origin: "relay", count: 1 })
    r.push({ t: 201, what: "editor redrew from the doc", origin: "doc", block: "b1", before: 4, after: 1 })
    r.seen(202, "b1", 1)
    expect(r.flags).toHaveLength(1)
    expect(r.flags[0]?.at).toMatchObject({ what: "dom text shrank", block: "b1", before: 4, after: 1, flag: "SHRANK WITHOUT A DELETE KEY" })
    expect(r.flags[0]?.before.map((e) => e.what)).toEqual(["key", "doc changed", "editor redrew from the doc"])
  })

  test("a line that shrinks after Backspace, Delete or a delete input isn't flagged", () => {
    const r = new TypingRecord()
    r.seen(0, "b1", 10)
    r.push({ t: 1000, what: "key", key: "Backspace" })
    r.seen(1001, "b1", 9)
    r.push({ t: 2000, what: "beforeinput", inputType: "deleteWordBackward" })
    r.seen(2001, "b1", 5)
    r.push({ t: 3000, what: "key", key: "Delete" })
    r.seen(3001, "b1", 4)
    expect(r.flags).toEqual([])
  })

  test("flags the line growing without a key, but not after typing, a paste or an accent", () => {
    const r = new TypingRecord()
    r.seen(0, "b1", 3)
    r.push({ t: 1000, what: "key", key: "char" })
    r.seen(1001, "b1", 4)
    r.push({ t: 2000, what: "beforeinput", inputType: "insertFromPaste" })
    r.seen(2001, "b1", 9)
    r.push({ t: 3000, what: "compositionend" })
    r.seen(3001, "b1", 10)
    r.push({ t: 4000, what: "key", key: "Backspace" })
    r.seen(4001, "b1", 9)
    expect(r.flags).toEqual([])
    r.push({ t: 5000, what: "doc changed", origin: "relay" })
    r.seen(5001, "b1", 10)
    expect(r.flags.map((f) => f.at.flag)).toEqual(["GREW WITHOUT A KEY"])
    expect(r.flags[0]?.before.at(-1)?.what).toBe("doc changed")
  })

  test("an entry carrying a flag is kept with the 24 entries before it", () => {
    const r = new TypingRecord()
    for (let i = 0; i < 30; i++) r.push({ t: i, what: "doc changed", origin: "relay", editor: 4, stored: 4 })
    r.push({ t: 30, what: "doc changed", origin: "relay", editor: 4, stored: 6, flag: "EDITOR OUT OF STEP WITH THE DOC" })
    expect(r.flags).toHaveLength(1)
    expect(r.flags[0]?.before).toHaveLength(24)
  })

  test("never keeps what was typed: keys are 'char', input data is its length and last three characters", () => {
    expect(keyName("a")).toBe("char")
    expect(keyName("ã")).toBe("char")
    expect(keyName("Backspace")).toBe("Backspace")
    expect(dataShape("a senha é hunter2")).toBe('17 chars, ends "er2"')
    expect(dataShape(null)).toBeUndefined()
    const r = new TypingRecord()
    r.push({ t: 0, what: "beforeinput", inputType: "insertText", data: dataShape("a senha é hunter2") ?? "" })
    expect(r.report({ agent: "test" })).not.toContain("hunter2")
  })

  test("keeps the most recent entries once it's full", () => {
    const r = new TypingRecord()
    for (let i = 0; i < 4100; i++) r.push({ t: i, what: "key", key: "char" })
    expect(r.entries).toHaveLength(4000)
    expect(r.entries[0]?.t).toBe(100)
  })
})
