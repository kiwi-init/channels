import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"
import { blocksOf, mediaOfBlock, newBlock, type BlockMedia } from "@kiwi/core/doc/blocks.ts"
import { heldPipe } from "@kiwi/core/doc/held-pipe.ts"
import { DOC_LEVEL, raiseWriterFloor } from "@kiwi/core/doc/level.ts"
import { pipeDoc } from "@kiwi/core/doc/pipe.ts"

import type { DocEvent } from "../../../../desktop/src/bridge.ts"
import { changeBlock } from "~/chat/doc/change-block"
import { LiveDoc, type OpenDoc, type Poster } from "~/chat/doc/live"
import { putAll, type DocMedia } from "~/chat/doc/media"
import { attached, composerKey, drafts, giveBack } from "~/chat/drafts"
import type { BlockFiles, Upload } from "~/model"
import { letSay, sayerAt } from "~/chat/doc/sayer"

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

interface Sent {
  text: string
  th: string
  id: string
  re?: number
  media?: BlockFiles
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
      post: (text, block, reply, media) => {
        posts.push({ text, th: block.th, id: block.id, ...(reply ? { re: reply.re } : {}), ...(media ? { media } : {}) })
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

function heldPosts(me: string): { live: LiveDoc; answer: (text: string, went: boolean) => void } {
  const waiting = new Map<string, (went: boolean) => void>()
  const live = new LiveDoc(relayOf(new Y.Doc()), undefined, () => {}, { me, post: (text) => new Promise<boolean>((done) => void waiting.set(text, done)) })
  return { live, answer: (text, went) => waiting.get(text)?.(went) }
}

const BLOB = "a".repeat(64)
const KEY = "k".repeat(43)

const media: DocMedia = {
  putImage: (u) => Promise.resolve({ name: u.name, mime: u.mime, ref: { id: BLOB, key: KEY, size: 4 } }),
  putFile: (u) => Promise.resolve({ name: u.name, mime: u.mime, size: 4, pieces: [{ id: BLOB, key: KEY, size: 4 }] }),
  image: () => Promise.resolve(null),
  file: () => Promise.resolve(null),
}

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

  test("refusals that land late and out of order never overwrite the draft being typed, and both go to the stash", async () => {
    const key = composerKey("late", { kind: "room", room: "general" })
    const stashed: string[] = []
    const back = (t: string, f: readonly Upload[]) => void giveBack(key, t, f, (_k, text) => stashed.push(text))
    const { live, answer } = heldPosts("jow")
    live.say("A", null, (t) => back(t, []))
    live.say("B", null, (t) => back(t, []))
    await wait(5)
    drafts.set(key, "C, being typed")
    answer("B", false)
    await wait(0)
    answer("A", false)
    await wait(0)
    expect(drafts.get(key)).toBe("C, being typed")
    expect(stashed).toEqual(["B", "A"])
    expect(lines(live.doc)).toEqual([])
    live.destroy()
  })

  test("a refusal comes back into an empty composer, and a later one waits in the stash", async () => {
    const key = composerKey("late", { kind: "room", room: "ops" })
    const stashed: string[] = []
    const back = (t: string, f: readonly Upload[]) => void giveBack(key, t, f, (_k, text) => stashed.push(text))
    const { live, answer } = heldPosts("jow")
    live.say("A", null, (t) => back(t, []))
    live.say("B", null, (t) => back(t, []))
    await wait(5)
    answer("B", false)
    await wait(0)
    answer("A", false)
    await wait(0)
    expect(drafts.get(key)).toBe("B")
    expect(attached.get(key)).toBeUndefined()
    expect(stashed).toEqual(["A"])
    live.destroy()
  })

  test("a PDF sent in a doc thread lands as a file in its block, and the post names it", async () => {
    const { live, posts, open } = liveFor("jow")
    const pdf: Upload = { name: "notes.pdf", mime: "application/pdf", data: "JVBERi0=" }
    const png: Upload = { name: "shot.png", mime: "image/png", data: "iVBORw==" }
    live.say("the notes", null, () => {}, putAll([pdf, png], media))
    open()
    await wait(5)
    const [block] = blocksOf(live.doc)
    const { files, imgs } = mediaOfBlock(live.doc, block!.id)
    expect(files.map((f) => f.name)).toEqual(["notes.pdf"])
    expect(imgs.map((i) => i.name)).toEqual(["shot.png"])
    expect(posts).toHaveLength(1)
    expect(posts[0]!.text).toContain("the notes")
    expect(posts[0]!.text).toContain("[file: notes.pdf]")
    expect(posts[0]!.id).toBe(block!.id)
    live.destroy()
  })

  test("the post carries the line's picture and file itself, so the message shows them without its block", async () => {
    const { live, posts, open } = liveFor("jow")
    const pdf: Upload = { name: "notes.pdf", mime: "application/pdf", data: "JVBERi0=" }
    const png: Upload = { name: "shot.png", mime: "image/png", data: "iVBORw==" }
    live.say("the notes", null, () => {}, putAll([pdf, png], media))
    open()
    await wait(5)
    expect(posts[0]!.media).toEqual({
      imgs: [{ name: "shot.png", mime: "image/png", ref: { id: BLOB, key: KEY, size: 4 } }],
      files: [{ name: "notes.pdf", mime: "application/pdf", size: 4, pieces: [{ id: BLOB, key: KEY, size: 4 }] }],
    })
    live.destroy()
  })

  test("the post's words leave out the picture it carries and still name the file, and the block keeps both", async () => {
    const { live, posts, open } = liveFor("jow")
    const pdf: Upload = { name: "notes.pdf", mime: "application/pdf", data: "JVBERi0=" }
    const png: Upload = { name: "shot.png", mime: "image/png", data: "iVBORw==" }
    live.say("the notes", null, () => {}, putAll([pdf, png], media))
    open()
    await wait(5)
    expect(posts[0]!.text.split("\n").toSorted()).toEqual(["[file: notes.pdf]", "the notes"])
    expect(blocksOf(live.doc)[0]!.text).toContain("[image: shot.png]")
    live.destroy()
  })

  test("a picture sent with no words posts no words", async () => {
    const { live, posts, open } = liveFor("jow")
    const png: Upload = { name: "shot.png", mime: "image/png", data: "iVBORw==" }
    live.say("", null, () => {}, putAll([png], media))
    await wait(5)
    open()
    await wait(5)
    expect(posts).toHaveLength(1)
    expect(posts[0]!.text).toBe("")
    expect(posts[0]!.media?.imgs.map((i) => i.name)).toEqual(["shot.png"])
    live.destroy()
  })

  test("a line with no picture or file posts without any", async () => {
    const { live, posts, open } = liveFor("jow")
    live.say("just words", null, () => {})
    open()
    await wait(5)
    expect(posts).toHaveLength(1)
    expect(posts[0]!.media).toBeUndefined()
    live.destroy()
  })

  test("a file that doesn't upload takes the line out of the doc and gives it back", async () => {
    const { live, posts, open } = liveFor("jow")
    const back: string[] = []
    live.say("the notes", null, (t) => back.push(t), Promise.reject(new Error("no room")))
    open()
    await wait(5)
    expect(blocksOf(live.doc)).toEqual([])
    expect(posts).toEqual([])
    expect(back).toEqual(["the notes"])
    live.destroy()
  })

  test("saving an edit changes the line's block in place: no new block, no new post", async () => {
    const host = new Y.Doc()
    const open = relayOf(host)
    const posts: string[] = []
    const a = new LiveDoc(open, undefined, () => {}, poster("jow", posts))
    a.say("ship it today", null, () => {})
    await wait(5)
    const [block] = blocksOf(host)
    const changed = await changeBlock((_thread, th, on) => open(th, on), new Map([["main", "th1"]]), { th: "th1", id: block!.id }, "ship it tomorrow", { wait: 1_000, linger: 0 })
    await wait(5)
    expect(changed).toBe(true)
    for (const doc of [host, a.doc]) expect(blocksOf(doc).map((b) => [b.id, b.text])).toEqual([[block!.id, "ship it tomorrow"]])
    expect(posts).toEqual(["ship it today"])
    a.destroy()
  })

  test("the composer finds a thread's doc only while it's open", () => {
    const key = "kiwi\nT10"
    expect(sayerAt(key)).toBeNull()
    const off = letSay(key, () => true)
    expect(sayerAt(key)?.("hi", null, () => {}, [])).toBe(true)
    off()
    expect(sayerAt(key)).toBeNull()
  })

  test("a doc closing in one view leaves the same thread open in another its composer", () => {
    const key = "kiwi\nT11"
    const first = letSay(key, () => true)
    const second = letSay(key, () => false)
    first()
    expect(sayerAt(key)?.("hi", null, () => {}, [])).toBe(false)
    second()
    expect(sayerAt(key)).toBeNull()
  })

  test("lines said into a new thread whose doc the relay won't open come back, one still uploading too, and later sends skip the doc", async () => {
    let on: ((e: DocEvent) => void) | null = null
    let uploaded: (m: readonly BlockMedia[]) => void = () => {}
    const posts: string[] = []
    const back: string[] = []
    const live = new LiveDoc(
      (_th, take) => {
        on = take
        return heldPipe().pipe
      },
      undefined,
      () => {},
      poster("jow", posts),
      () => Promise.resolve(null)
    )
    live.say("first", null, (t) => back.push(t))
    live.say("uploading", null, (t) => back.push(t), new Promise<readonly BlockMedia[]>((done) => (uploaded = done)))
    await wait(5)
    ;(on as ((e: DocEvent) => void) | null)?.({ _tag: "Failed", error: { kind: "relay", status: 403, message: "read-only", tag: "ReadOnly" } })
    await wait(5)
    expect(back).toEqual(["first"])
    uploaded([])
    await wait(5)
    expect(back).toEqual(["first", "uploading"])
    expect(blocksOf(live.doc)).toEqual([])
    expect(posts).toEqual([])
    expect(live.say("third", null, (t) => back.push(t))).toBe(false)
    live.destroy()
  })

  test("a doc a newer app writes takes no line from this one", async () => {
    const { live, posts, open } = liveFor("jow")
    raiseWriterFloor(live.doc, DOC_LEVEL + 1)
    expect(live.say("from an older app", null, () => {})).toBe(false)
    open()
    await wait(0)
    expect(blocksOf(live.doc)).toEqual([])
    expect(posts).toEqual([])
    live.destroy()
  })
})
