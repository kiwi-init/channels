import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { appendToBlock, blocksOf, newBlock, type BlockKind } from "@kiwi/core/doc/blocks.ts"
import { heldPipe } from "@kiwi/core/doc/held-pipe.ts"

import type { DocEvent } from "../../../../desktop/src/bridge.ts"
import { LiveDoc } from "~/chat/doc/live"
import { postFinished, type Finished } from "~/chat/doc/post"

const REMOTE = Symbol("remote")
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

function watch(doc: Y.Doc): Finished[] {
  const out: Finished[] = []
  postFinished(doc, { me: "jow", local: (o) => o !== REMOTE }, (b) => out.push(b))
  return out
}

function start(doc: Y.Doc, author: string, text = "", kind: BlockKind = "text", origin: unknown = null): string {
  let id = ""
  doc.transact(() => {
    id = newBlock(doc, kind, author, text).id
  }, origin)
  return id
}

const type = (doc: Y.Doc, id: string, text: string, origin: unknown = null) => doc.transact(() => appendToBlock(doc, id, text), origin)

describe("a person's block posts as their message when they press Enter", () => {
  test("a block is a draft while you type, however long you pause, and posts once when you start the next", async () => {
    const doc = new Y.Doc()
    const out = watch(doc)
    const id = start(doc, "jow")
    type(doc, id, "  ship the ")
    await wait(50)
    type(doc, id, "release ")
    await wait(50)
    expect(out).toEqual([])
    start(doc, "jow")
    expect(out).toEqual([{ id, text: "ship the release" }])
    start(doc, "jow")
    expect(out).toHaveLength(1)
  })

  test("starting your next block posts the one before at once", () => {
    const doc = new Y.Doc()
    const out = watch(doc)
    const first = start(doc, "jow", "first thought")
    expect(out).toEqual([])
    start(doc, "jow")
    expect(out).toEqual([{ id: first, text: "first thought" }])
  })

  test("Enter marks the block sent in the doc, so every viewer stops showing it as a draft", () => {
    const doc = new Y.Doc()
    const peer = new Y.Doc()
    doc.on("update", (u: Uint8Array) => Y.applyUpdate(peer, u))
    watch(doc)
    const first = start(doc, "jow", "first thought")
    const sentOf = (d: Y.Doc, id: string) => blocksOf(d).find((b) => b.id === id)?.sent ?? false
    expect(sentOf(peer, first)).toBe(false)
    const next = start(doc, "jow")
    expect(sentOf(doc, first)).toBe(true)
    expect(sentOf(peer, first)).toBe(true)
    expect(sentOf(peer, next)).toBe(false)
  })

  test("other people's blocks, agent and tool blocks, empty blocks and blocks from elsewhere never post", async () => {
    const doc = new Y.Doc()
    const old = start(doc, "jow", "written before")
    const out = watch(doc)
    type(doc, old, " and edited now")
    start(doc, "maya", "hers")
    start(doc, "jow", "agent words", "agent")
    start(doc, "jow", "a tool", "tool")
    start(doc, "jow", "   ")
    const other = start(doc, "jow", "", "text", REMOTE)
    type(doc, other, "typed on my other computer", REMOTE)
    start(doc, "jow", "", "text", REMOTE)
    expect(out).toEqual([])
  })

  test("only Enter in a block sends it: a block after it from someone else, or one you start elsewhere, doesn't", () => {
    const doc = new Y.Doc()
    const out = watch(doc)
    const id = start(doc, "jow", "still typing")
    start(doc, "atlas", "on it", "agent", REMOTE)
    expect(out).toEqual([])
    start(doc, "jow")
    expect(out).toEqual([])
    expect(id).toBeTruthy()
  })

  test("the message carries the doc it came from, once the doc has one", async () => {
    const posts: [string, string, string][] = []
    let open: ((e: DocEvent) => void) | null = null
    const live = new LiveDoc(
      (_th, on) => {
        open = on
        return heldPipe().pipe
      },
      undefined,
      () => {},
      { me: "jow", post: (text, block) => posts.push([text, block.th, block.id]) }
    )
    const id = start(live.doc, "jow", "hello there")
    start(live.doc, "jow")
    expect(posts).toEqual([])
    const opened = open as ((e: DocEvent) => void) | null
    opened?.({ _tag: "Open", th: "th1" })
    expect(posts).toEqual([["hello there", "th1", id]])
    live.destroy()
  })
})
