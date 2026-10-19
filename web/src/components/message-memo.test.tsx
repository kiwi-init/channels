import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts"

import { knownRefs, Recent } from "../lib/markdown"
import { Markdown, renderMarkdown } from "./markdown"
import type { MessageProps } from "./message"
import { sameRow, sameValue } from "./message-memo"

const msg = (seq: number, body: string, extra: Partial<Message> = {}): Message => ({ v: PROTOCOL_VERSION, id: String(seq), from: "atlas", kind: "msg", body, ts: 0, seq, sigOk: true, ...extra })

const sameName = (n: string) => n
const jumpTo = () => {}

const props = (m: Message, extra: Partial<MessageProps> = {}): MessageProps => ({
  m,
  me: "jow",
  online: true,
  first: true,
  adjacentReply: false,
  highlighted: false,
  quoted: () => undefined,
  nameOf: sameName,
  onJump: jumpTo,
  ...extra,
})

describe("a message row renders again only when what it shows changes", () => {
  const m = msg(5, "steady numbers look fine")

  test("equal props, and derived arrays rebuilt with the same contents, keep the row", () => {
    const a = props(m, { reactions: [{ emoji: "👍", who: ["win"], mine: false }] })
    const b = props(m, { quoted: () => undefined, reactions: [{ emoji: "👍", who: ["win"], mine: false }] })
    expect(sameRow(a, b)).toBe(true)
  })

  test("a new reaction, a new name lookup or a highlight renders it again", () => {
    const base = props(m)
    expect(sameRow(base, { ...base, reactions: [{ emoji: "🎉", who: ["jow"], mine: true }] })).toBe(false)
    expect(sameRow(base, { ...base, nameOf: (n: string) => n.toUpperCase() })).toBe(false)
    expect(sameRow(base, { ...base, highlighted: true })).toBe(false)
  })

  test("an answer can be given or not: only that matters, not a fresh closure", () => {
    const base = props(m, { onChoose: () => {} })
    expect(sameRow(base, { ...base, onChoose: () => {} })).toBe(true)
    expect(sameRow(base, { ...base, onChoose: undefined })).toBe(false)
  })

  test("a reply renders again when the message it quotes resolves differently, not when others arrive", () => {
    const parent = msg(3, "the parent")
    const reply = msg(6, "agreed, and see #3", { re: [3] })
    const before = props(reply, { quoted: (s) => (s === 3 ? parent : undefined) })
    const more = props(reply, { quoted: (s) => (s === 3 ? parent : s === 7 ? msg(7, "new") : undefined) })
    const gone = props(reply, { quoted: () => undefined })
    expect(sameRow(before, more)).toBe(true)
    expect(sameRow(before, gone)).toBe(false)
  })
})

describe("markdown is parsed once per body", () => {
  test("the same body and known references give the same tree", () => {
    const known = (seq: number) => seq === 12
    expect(renderMarkdown("ship it, see #12", known)).toBe(renderMarkdown("ship it, see #12", known))
    expect(renderMarkdown("ship it, see #12", known)).not.toBe(renderMarkdown("ship it, see #12", () => false))
  })

  test("a cached tree still renders references as buttons", () => {
    const html = renderToStaticMarkup(createElement(Markdown, { refs: { known: (s: number) => s === 12, open: () => {} } }, "see #12 and #13"))
    expect(html).toContain(">#12</button>")
    expect(html).not.toContain(">#13</button>")
  })

  test("knownRefs lists the references a body makes to known messages", () => {
    expect(knownRefs("#1 and #2, not `x`", (s) => s === 2)).toBe("2")
  })

  test("Recent keeps the newest and forgets the oldest", () => {
    const r = new Recent<number>(2)
    r.set("a", 1)
    r.set("b", 2)
    expect(r.get("a")).toBe(1)
    r.set("c", 3)
    expect(r.get("b")).toBeUndefined()
    expect(r.get("a")).toBe(1)
    expect(r.get("c")).toBe(3)
  })
})

describe("comparing what a row shows by value", () => {
  test("same contents in new objects are the same, in any key order, with unset keys ignored", () => {
    expect(sameValue([{ emoji: "👍", who: ["win"], mine: false }], [{ mine: false, who: ["win"], emoji: "👍" }])).toBe(true)
    expect(sameValue({ count: 2, forYou: false, color: undefined }, { count: 2, forYou: false })).toBe(true)
    expect(sameValue({ people: [{ name: "a" }] }, { people: [{ name: "a" }] })).toBe(true)
  })

  test("any change in a value, a length or a kind is a change", () => {
    expect(sameValue([{ who: ["win"] }], [{ who: ["win", "jow"] }])).toBe(false)
    expect(sameValue({ count: 2 }, { count: 3 })).toBe(false)
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(sameValue([1], { 0: 1 })).toBe(false)
    expect(sameValue(null, {})).toBe(false)
  })
})
