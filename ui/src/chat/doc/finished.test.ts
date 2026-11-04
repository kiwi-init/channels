import { describe, expect, test } from "bun:test"
import { appendToBlock, blocksOf, markBack, markPosted, newBlock, richBlocks, type Block } from "@kiwi/core/doc/blocks.ts"
import { prosemirrorToYDoc } from "y-prosemirror"
import * as Y from "yjs"

import { docFeed, withLines } from "~/chat/doc/finished"
import { FRAGMENT, schema } from "~/chat/doc/schema"
import type { Message } from "~/model"

const T = 1_700_000_000_000
const { block, paragraph, mention, bullet_list, list_item, code_block, image } = schema.nodes
const where = { kind: "room", room: "general" } as const

const line = (id: string, author: string, at: number, extra: Partial<Block> = {}): Block => ({ id, kind: "text", author, at, text: `${author} at ${at}`, ...extra })
const msg = (seq: number, at: number): Message => ({ seq, from: "atlas", at, text: `#${seq}`, where })

describe("a posted doc line keeps its formatting (T1463)", () => {
  test("a block reads as markdown: marks, mentions, lists and code; an image makes it a media block", () => {
    const doc = schema.nodes.doc.create(null, [
      block.create({ id: "AAAAAAAAAAAAAAAAAAAAAA", kind: "text", author: "jow", at: T }, [
        paragraph.create(null, [
          schema.text("ping "),
          mention.create({ name: "atlas" }),
          schema.text(" the "),
          schema.text("relay", [schema.marks.strong.create()]),
          schema.text(" and "),
          schema.text("bun test", [schema.marks.code.create()]),
        ]),
        bullet_list.create(null, [list_item.create(null, paragraph.create(null, schema.text("one"))), list_item.create(null, paragraph.create(null, schema.text("two", [schema.marks.em.create()])))]),
        code_block.create(null, schema.text("bun run ui:build")),
      ]),
      block.create({ id: "BBBBBBBBBBBBBBBBBBBBBB", kind: "text", author: "jow", at: T + 1 }, paragraph.create(null, [schema.text("look "), image.create({ name: "shot.png" })])),
    ])
    const rich = richBlocks(prosemirrorToYDoc(doc, FRAGMENT))
    expect(rich.get("AAAAAAAAAAAAAAAAAAAAAA")).toEqual({ id: "AAAAAAAAAAAAAAAAAAAAAA", markdown: "ping @atlas the **relay** and `bun test`\n- one\n- _two_\n```\nbun run ui:build\n```", media: false })
    expect(rich.get("BBBBBBBBBBBBBBBBBBBBBB")?.media).toBe(true)
  })
})

describe("finished doc lines with no message sit in the feed at their time (T1354)", () => {
  test("a finished line with no message moves to the feed and leaves the doc; a draft, a posted line and a media line stay", () => {
    const blocks = [
      line("old-sent", "atlas", T + 10, { kind: "agent", sent: true }),
      line("jow-1", "jow", T + 20),
      line("posted", "maya", T + 30, { sent: true }),
      line("media", "maya", T + 40, { sent: true }),
      line("jow-draft", "jow", T + 50),
    ]
    const rich = new Map([["media", { id: "media", markdown: "look [image: a.png]", media: true }]])
    const feed = docFeed(blocks, rich, new Set(["posted"]), T)
    expect(feed.lines.map((l) => l.id)).toEqual(["old-sent", "jow-1"])
    expect([...feed.hidden].sort()).toEqual(["jow-1", "old-sent"])
    expect([...feed.media]).toEqual(["media"])
  })

  test("a finished line older than the oldest loaded message leaves the doc but doesn't come back as a feed row", () => {
    const feed = docFeed([line("ancient", "atlas", T, { sent: true }), line("recent", "atlas", T + 100, { sent: true })], new Map(), new Set(), T + 50)
    expect(feed.lines.map((l) => l.id)).toEqual(["recent"])
    expect(feed.hidden.has("ancient")).toBe(true)
  })

  test("feed rows land between messages by time, and carry no actions", () => {
    const rows = withLines(
      [msg(1, T + 10), msg(2, T + 30)],
      [
        { id: "x", author: "jow", at: T + 20, text: "between" },
        { id: "y", author: "jow", at: T + 40, text: "after" },
      ],
      where
    )
    expect(rows.map((m) => m.text)).toEqual(["#1", "between", "#2", "after"])
    expect(rows[1]).toMatchObject({ from: "jow", block: "x", fromDoc: true })
    expect(rows[1]!.seq).toBeGreaterThan(1)
    expect(rows[1]!.seq).toBeLessThan(2)
  })
})

describe("a line given back to its author stays their draft in the doc (T1678)", () => {
  test("a later empty block or a later draft never finishes it; sending it again does", () => {
    const doc = new Y.Doc()
    const old = newBlock(doc, "text", "jow", "a line from before lines were sent", T)
    const a = newBlock(doc, "text", "jow", "ship it", T + 10)
    markPosted(doc, a.id)
    const b = newBlock(doc, "text", "jow", "", T + 20)
    const feed = () => docFeed(blocksOf(doc), richBlocks(doc), new Set(), T)
    expect([...feed().hidden].sort()).toEqual([old.id, a.id].sort())
    markBack(doc, a.id)
    expect(feed().hidden.has(a.id)).toBe(false)
    expect(feed().lines.map((l) => l.text)).toEqual(["a line from before lines were sent"])
    appendToBlock(doc, b.id, "next line")
    markPosted(doc, b.id)
    newBlock(doc, "text", "jow", "", T + 30)
    expect(feed().hidden.has(a.id)).toBe(false)
    expect(feed().lines.map((l) => l.text)).toEqual(["a line from before lines were sent", "next line"])
    markPosted(doc, a.id)
    expect(feed().lines.map((l) => l.text)).toEqual(["a line from before lines were sent", "ship it", "next line"])
  })

  test("a line from before blocks were marked sent still joins the feed once its author writes on (#1612)", () => {
    const feed = docFeed([line("legacy", "jow", T + 10), line("next", "jow", T + 20)], new Map(), new Set(), T)
    expect(feed.lines.map((l) => l.id)).toEqual(["legacy"])
    expect(feed.hidden.has("legacy")).toBe(true)
  })

  test("an empty line from your other window after the line you're typing never takes it out of your doc (T2106)", () => {
    const typing = [line("draft", "jow", T + 10, { text: "Salve mis" }), line("other-window", "jow", T + 20, { text: "" })]
    const feed = docFeed(typing, new Map(), new Set(), T)
    expect(feed.lines).toEqual([])
    expect(feed.hidden.has("draft")).toBe(false)
    const entered = docFeed([{ ...typing[0]!, sent: true }, typing[1]!], new Map(), new Set(), T)
    expect(entered.hidden.has("draft")).toBe(true)
  })
})
