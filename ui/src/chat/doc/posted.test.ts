import { describe, expect, test } from "bun:test"

import { inFeed, postedBlocks } from "~/chat/doc/posted"

type Line = { seq: number; from: string; text: string; block?: string; pending?: boolean }

const lines: Line[] = [
  { seq: 1217, from: "jow", text: "Finally we back ?", block: "b1217" },
  { seq: 1218, from: "warm-orca", text: "Which channel flickers?" },
  { seq: 1220, from: "jow", text: "Still the crazy flickering", block: "b1220" },
  { seq: 1221, from: "jow", text: "on its way", block: "b1221", pending: true },
]

describe("a room's feed and its doc", () => {
  test("a person's posted lines take their place in the feed, around an agent's post, and leave the doc", () => {
    const feed = lines.filter((m) => inFeed(m, true)).map((m) => m.seq)
    expect(feed).toEqual([1217, 1218, 1220])
    const posted = postedBlocks(lines)
    expect([...posted]).toEqual(["b1217", "b1220"])
  })

  test("a line still on its way stays in the doc, so each line shows in exactly one place", () => {
    const posted = postedBlocks(lines)
    const places = lines.flatMap((m) => (m.block === undefined ? [] : [{ seq: m.seq, feed: inFeed(m, true), doc: !posted.has(m.block) }]))
    expect(places).toEqual([
      { seq: 1217, feed: true, doc: false },
      { seq: 1220, feed: true, doc: false },
      { seq: 1221, feed: false, doc: true },
    ])
  })

  test("without a doc every message is in the feed", () => {
    expect(lines.filter((m) => inFeed(m, false)).map((m) => m.seq)).toEqual([1217, 1218, 1220, 1221])
  })
})
