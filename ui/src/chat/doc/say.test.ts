import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"
import { blocksOf, newBlock } from "@kiwi/core/doc/blocks.ts"
import { heldPipe } from "@kiwi/core/doc/held-pipe.ts"
import { pipeDoc } from "@kiwi/core/doc/pipe.ts"

import type { DocEvent } from "../../../../desktop/src/bridge.ts"
import { LiveDoc, type OpenDoc, type Poster } from "~/chat/doc/live"
import { letSay, sayerAt } from "~/chat/doc/sayer"

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

interface Sent {
  text: string
  th: string
  id: string
  re?: number
}

function liveFor(me: string, answer: () => boolean = () => true): { live: LiveDoc; posts: Sent[]; open: () => void } {
  const posts: Sent[] = []
  let on: ((e: DocEvent) => void) | null = null
  const live = new LiveDoc(
    (_th, take) => {
      on = take
      return heldPipe().pipe
    },
    undefined,
    () => {},
    {
      me,
      post: (text, block, reply) => {
        posts.push({ text, th: block.th, id: block.id, ...(reply ? { re: reply.re } : {}) })
        return Promise.resolve(answer())
      },
    }
  )
  return { live, posts, open: () => (on as ((e: DocEvent) => void) | null)?.({ _tag: "Open", th: "th1" }) }
}

function relayOf(host: Y.Doc): OpenDoc {
  const awareness = new Awareness(host)
  return (_th, on) => {
    const { pipe, attach } = heldPipe()
    void Promise.resolve().then(() => {
      on({ _tag: "Open", th: "th1" })
      attach(pipeDoc(host, awareness, on))
    })
    return pipe
  }
}

const poster = (me: string, posts: string[]): Poster => ({
  me,
  post: (text) => {
    posts.push(text)
    return Promise.resolve(true)
  },
})

const lines = (doc: Y.Doc): string[] => blocksOf(doc).map((b) => b.text)

describe("the composer writes into the thread's doc (T5115)", () => {
  test("a send lands as your block in the doc and posts once, carrying the block", async () => {
    const { live, posts, open } = liveFor("jow")
    expect(live.say("ship it **today**", null, () => {})).toBe(true)
    open()
    const [block] = blocksOf(live.doc)
    expect(block).toMatchObject({ author: "jow", kind: "text", text: "ship it **today**", posted: true })
    expect(posts).toEqual([{ text: "ship it **today**", th: "th1", id: block!.id }])
    live.say("and the notes", { re: 12 }, () => {})
    newBlock(live.doc, "text", "jow", "")
    await wait(0)
    expect(posts.map((p) => p.text)).toEqual(["ship it **today**", "and the notes"])
    expect(posts[1]!.re).toBe(12)
    live.destroy()
  })

  test("a refused send leaves the doc and comes back as your draft", async () => {
    const { live, posts, open } = liveFor("jow", () => false)
    const back: string[] = []
    live.say("ship it", null, (text) => back.push(text))
    open()
    await wait(0)
    expect(posts).toHaveLength(1)
    expect(blocksOf(live.doc)).toEqual([])
    expect(back).toEqual(["ship it"])
    live.destroy()
  })

  test("two people sending at once both land in the shared doc, each posted once by its own writer", async () => {
    const a = liveFor("jow")
    const b = liveFor("maya")
    a.live.say("first", null, () => {})
    b.live.say("second", null, () => {})
    a.open()
    b.open()
    Y.applyUpdate(b.live.doc, Y.encodeStateAsUpdate(a.live.doc))
    Y.applyUpdate(a.live.doc, Y.encodeStateAsUpdate(b.live.doc))
    await wait(0)
    for (const side of [a, b])
      expect(
        blocksOf(side.live.doc)
          .map((x) => x.text)
          .sort()
      ).toEqual(["first", "second"])
    expect(a.posts.map((p) => p.text)).toEqual(["first"])
    expect(b.posts.map((p) => p.text)).toEqual(["second"])
    a.live.destroy()
    b.live.destroy()
  })

  test("two windows sending into a new thread before either has its doc both reach the relay", async () => {
    const host = new Y.Doc()
    const open = relayOf(host)
    const posts: string[] = []
    const a = new LiveDoc(open, undefined, () => {}, poster("jow", posts))
    const b = new LiveDoc(open, undefined, () => {}, poster("jow", posts))
    a.say("from one", null, () => {})
    b.say("from two", null, () => {})
    await wait(5)
    for (const doc of [host, a.doc, b.doc]) expect(lines(doc).sort()).toEqual(["from one", "from two"])
    a.destroy()
    b.destroy()
  })

  test("a window that joins the doc another window started still gets its sends to the relay", async () => {
    const host = new Y.Doc()
    const open = relayOf(host)
    const posts: string[] = []
    const a = new LiveDoc(open, undefined, () => {}, poster("jow", posts))
    const b = new LiveDoc(open, undefined, () => {}, poster("jow", posts))
    a.say("first", null, () => {})
    await wait(5)
    b.want("th1")
    await wait(5)
    b.say("second", null, () => {})
    a.say("third", null, () => {})
    await wait(5)
    for (const doc of [host, a.doc, b.doc]) expect(lines(doc)).toEqual(["first", "second", "third"])
    expect(posts).toEqual(["first", "second", "third"])
    a.destroy()
    b.destroy()
  })

  test("the composer finds a thread's doc only while it's open", () => {
    const key = "kiwi\nT10"
    expect(sayerAt(key)).toBeNull()
    const off = letSay(key, () => true)
    expect(sayerAt(key)?.("hi", null, () => {})).toBe(true)
    off()
    expect(sayerAt(key)).toBeNull()
  })
})
