import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { appendToBlock, blocksOf, newBlock, richBlocks, threadOf, type BlockKind } from "@kiwi/core/doc/blocks.ts"
import { heldPipe } from "@kiwi/core/doc/held-pipe.ts"
import { EditorState, TextSelection, type Plugin, type PluginView, type Transaction } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { ySyncPlugin } from "y-prosemirror"

import type { DocEvent } from "../../../../desktop/src/bridge.ts"
import { blockAfter, blocks, startBlock } from "~/chat/doc/blocks"
import { docFeed } from "~/chat/doc/feed-of"
import { giveBackBlock, onGiveBack } from "~/chat/doc/give-back"
import type { Pending } from "~/live/map"
import { unsentBlock } from "~/live/unsent"
import { LiveDoc } from "~/chat/doc/live"
import { postFinished, type Finished } from "~/chat/doc/post"
import { FRAGMENT, isBack, isSent, schema } from "~/chat/doc/schema"

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

interface Bound {
  state: () => EditorState
  dispatch: (tr: Transaction | null) => void
}

function bound(doc: Y.Doc): Bound {
  const sync: Plugin = ySyncPlugin(doc.getXmlFragment(FRAGMENT))
  let state = EditorState.create({ schema, plugins: [sync] })
  const views: PluginView[] = []
  const host = {
    get state() {
      return state
    },
    hasFocus: () => false,
    dispatch: (tr: Transaction) => {
      const prev = state
      state = state.apply(tr)
      for (const v of views) v.update?.(view, prev)
    },
  }
  const view = host as unknown as EditorView
  const made = sync.spec.view?.(view)
  if (made) views.push(made)
  return { state: () => state, dispatch: (tr) => tr && host.dispatch(tr) }
}

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

  test("a reply or a quote on the block posts with it (T1402)", () => {
    const doc = new Y.Doc()
    const out = watch(doc)
    const id = start(doc, "jow", "agreed")
    doc.transact(() => {
      const el = threadOf(doc).get(0)
      if (!(el instanceof Y.XmlElement)) throw new Error("no block")
      el.setAttribute("re", 12)
      el.setAttribute("quote", "ship it friday")
    })
    start(doc, "jow")
    expect(out).toEqual([{ id, text: "agreed", re: 12, quote: "ship it friday" }])
  })

  test("starting your next block posts the one before at once", () => {
    const doc = new Y.Doc()
    const out = watch(doc)
    const first = start(doc, "jow", "first thought")
    expect(out).toEqual([])
    start(doc, "jow")
    expect(out).toEqual([{ id: first, text: "first thought" }])
  })

  test("Enter marks the block sent in the doc, so every viewer stops showing it as a draft", async () => {
    const doc = new Y.Doc()
    const peer = new Y.Doc()
    doc.on("update", (u: Uint8Array) => Y.applyUpdate(peer, u))
    watch(doc)
    const first = start(doc, "jow", "first thought")
    const sentOf = (d: Y.Doc, id: string) => blocksOf(d).find((b) => b.id === id)?.sent ?? false
    expect(sentOf(peer, first)).toBe(false)
    const next = start(doc, "jow")
    await wait(0)
    expect(sentOf(doc, first)).toBe(true)
    expect(sentOf(peer, first)).toBe(true)
    expect(sentOf(peer, next)).toBe(false)
  })

  test("other people's blocks, agent and tool blocks, empty blocks and blocks from elsewhere never post", async () => {
    const doc = new Y.Doc()
    const out = watch(doc)
    start(doc, "maya", "hers")
    start(doc, "jow", "agent words", "agent")
    start(doc, "jow", "a tool", "tool")
    start(doc, "jow", "   ")
    start(doc, "jow")
    const other = start(doc, "jow", "", "text", REMOTE)
    type(doc, other, "typed on my other computer", REMOTE)
    start(doc, "jow", "", "text", REMOTE)
    expect(out).toEqual([])
  })

  test("someone else's block landing after your draft doesn't send it, nor does a block of yours from elsewhere; your next block here does (T1464)", () => {
    const doc = new Y.Doc()
    const out = watch(doc)
    const id = start(doc, "jow", "still typing")
    start(doc, "atlas", "on it", "agent", REMOTE)
    start(doc, "jow", "", "text", REMOTE)
    expect(out).toEqual([])
    start(doc, "jow")
    expect(out).toEqual([{ id, text: "still typing" }])
  })

  test("a line you began before the doc was reopened posts when you finish it and press Enter (T1464)", () => {
    const doc = new Y.Doc()
    const id = start(doc, "jow", "half a ", "text", REMOTE)
    const out = watch(doc)
    type(doc, id, "line")
    start(doc, "jow")
    expect(out).toEqual([{ id, text: "half a line" }])
  })

  test("Enter posts only the line it was pressed on: never an earlier line of yours, another window's draft, or one that already has a message (T1464, T1776)", async () => {
    const doc = new Y.Doc()
    const out: Finished[] = []
    const messages = new Set<string>()
    const entered = new Set<string>()
    postFinished(doc, { me: "jow", local: (o) => o !== REMOTE, posted: (b) => messages.has(b), owned: (b) => entered.has(b.id) }, (b) => out.push(b))
    const legacy = start(doc, "jow", "from before lines posted", "text", REMOTE)
    const answered = start(doc, "jow", "already a message", "text", REMOTE)
    messages.add(answered)
    const a = start(doc, "jow", "one", "text", REMOTE)
    start(doc, "maya", "hers", "text", REMOTE)
    const b = start(doc, "jow", "two", "text", REMOTE)
    entered.add(b)
    start(doc, "jow")
    expect(out).toEqual([{ id: b, text: "two" }])
    await wait(0)
    start(doc, "jow", "three")
    start(doc, "jow")
    expect(out.map((x) => x.text)).toEqual(["two", "three"])
    expect(out.some((x) => x.id === legacy || x.id === a || x.id === answered)).toBe(false)
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
      {
        me: "jow",
        post: (text, block) => {
          posts.push([text, block.th, block.id])
          return Promise.resolve(true)
        },
      }
    )
    const id = start(live.doc, "jow", "hello there")
    start(live.doc, "jow")
    expect(posts).toEqual([])
    const opened = open as ((e: DocEvent) => void) | null
    opened?.({ _tag: "Open", th: "th1" })
    expect(posts).toEqual([["hello there", "th1", id]])
    live.destroy()
  })

  test("a send the channel refuses comes back as your draft, and Enter in it posts it again (T1401)", async () => {
    const posts: string[] = []
    let refuse = true
    let open: ((e: DocEvent) => void) | null = null
    const live = new LiveDoc(
      (_th, on) => {
        open = on
        return heldPipe().pipe
      },
      undefined,
      () => {},
      {
        me: "jow",
        post: (text) => {
          posts.push(text)
          return Promise.resolve(!refuse)
        },
      }
    )
    const sentOf = (id: string) => blocksOf(live.doc).find((b) => b.id === id)?.sent ?? false
    const id = start(live.doc, "jow", "ship it")
    start(live.doc, "jow")
    const opened = open as ((e: DocEvent) => void) | null
    opened?.({ _tag: "Open", th: "th1" })
    expect(posts).toEqual(["ship it"])
    await wait(0)
    expect(sentOf(id)).toBe(false)
    refuse = false
    live.doc.transact(() => threadOf(live.doc).delete(threadOf(live.doc).length - 1, 1))
    start(live.doc, "jow")
    expect(posts).toEqual(["ship it", "ship it"])
    await wait(0)
    expect(sentOf(id)).toBe(true)
    live.destroy()
  })

  test("your own editor learns your line was sent, so it stops being a draft there and an edit can't unsend it (T1464)", async () => {
    const doc = new Y.Doc()
    const out = watch(doc)
    const ed = bound(doc)
    ed.dispatch(startBlock(ed.state(), "jow", 1))
    ed.dispatch(ed.state().tr.insertText("ship it"))
    ed.dispatch(blockAfter(ed.state(), "jow", 2))
    await wait(0)
    expect(out.map((b) => b.text)).toEqual(["ship it"])
    expect(blocks(ed.state().doc).map((b) => isSent(b.node))).toEqual([true, false])
    ed.dispatch(ed.state().tr.insertText("next"))
    expect(blocksOf(doc).map((b) => b.sent ?? false)).toEqual([true, false])
  })

  test("Back to draft on a failed line gives its block back, and Enter posts it again (T1606)", async () => {
    const doc = new Y.Doc()
    const posts: string[] = []
    const posting = postFinished(doc, { me: "jow", local: (o) => o !== REMOTE }, (f) => posts.push(f.text))
    const id = start(doc, "jow", "ship it")
    start(doc, "jow")
    await wait(0)
    const failed: Pending[] = [
      { key: 7, where: { kind: "main" } as Pending["where"], text: "ship it", at: 1, failed: "offline", block: { th: "th1", id } },
      { key: 8, where: { kind: "main" } as Pending["where"], text: "not a doc line", at: 2, failed: "offline" },
    ]
    expect(unsentBlock(failed, 8)).toBeNull()
    const back = unsentBlock(failed, 7)
    if (!back) throw new Error("no block")
    giveBackBlock(back)
    expect(blocksOf(doc).find((b) => b.id === id)?.sent ?? false).toBe(false)
    doc.transact(() => threadOf(doc).delete(threadOf(doc).length - 1, 1))
    start(doc, "jow")
    expect(posts).toEqual(["ship it", "ship it"])
    posting.stop()
  })

  test("a retried line the channel refuses comes back as a draft in its own doc only, and posts again (T1465)", async () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    const posts: string[] = []
    const posting = postFinished(a, { me: "jow", local: (o) => o !== REMOTE }, (f) => posts.push(f.text))
    const other = postFinished(b, { me: "jow", local: (o) => o !== REMOTE }, () => {})
    const sentOf = (d: Y.Doc, id: string) => blocksOf(d).find((x) => x.id === id)?.sent ?? false
    const id = start(a, "jow", "ship it")
    const elsewhere = start(b, "jow", "not this one")
    start(a, "jow")
    start(b, "jow")
    await wait(0)
    expect([sentOf(a, id), sentOf(b, elsewhere)]).toEqual([true, true])
    giveBackBlock(id)
    expect([sentOf(a, id), sentOf(b, elsewhere)]).toEqual([false, true])
    a.transact(() => threadOf(a).delete(threadOf(a).length - 1, 1))
    start(a, "jow")
    expect(posts).toEqual(["ship it", "ship it"])
    posting.stop()
    other.stop()
    giveBackBlock(elsewhere)
    expect(sentOf(b, elsewhere)).toBe(true)
  })
})

describe("Back to draft keeps the line in the doc, so it's never resent (T1678)", () => {
  const inDoc = (doc: Y.Doc, id: string) => !docFeed(blocksOf(doc), richBlocks(doc), new Set(), 0).hidden.has(id)
  const enterAtEndOf = (ed: Bound, index: number, at: number) => {
    const b = blocks(ed.state().doc)[index]
    if (!b) throw new Error("no block")
    ed.dispatch(ed.state().tr.setSelection(TextSelection.near(ed.state().doc.resolve(b.pos + b.node.nodeSize - 1), -1)))
    ed.dispatch(blockAfter(ed.state(), "jow", at))
  }

  test("Enter, Back to draft, then a line typed in the block below: the given-back line stays a draft and posts only when Enter is pressed on it", async () => {
    const doc = new Y.Doc()
    const posts: string[] = []
    const posting = postFinished(doc, { me: "jow", local: (o) => o !== REMOTE }, (f) => posts.push(f.text))
    const ed = bound(doc)
    ed.dispatch(startBlock(ed.state(), "jow", 1))
    ed.dispatch(ed.state().tr.insertText("ship it"))
    ed.dispatch(blockAfter(ed.state(), "jow", 2))
    await wait(0)
    expect(posts).toEqual(["ship it"])
    const id = blocksOf(doc)[0]!.id
    expect(inDoc(doc, id)).toBe(false)
    giveBackBlock(id)
    expect(inDoc(doc, id)).toBe(true)
    expect(isBack(ed.state().doc.child(0))).toBe(true)
    ed.dispatch(ed.state().tr.insertText("next line"))
    expect(inDoc(doc, id)).toBe(true)
    ed.dispatch(blockAfter(ed.state(), "jow", 3))
    await wait(0)
    expect(posts).toEqual(["ship it", "next line"])
    expect(inDoc(doc, id)).toBe(true)
    ed.dispatch(ed.state().tr.insertText("third"))
    ed.dispatch(blockAfter(ed.state(), "jow", 4))
    await wait(0)
    expect(posts).toEqual(["ship it", "next line", "third"])
    enterAtEndOf(ed, 0, 5)
    await wait(0)
    expect(posts).toEqual(["ship it", "next line", "third", "ship it"])
    expect(inDoc(doc, id)).toBe(false)
    expect(blocksOf(doc).find((b) => b.id === id)).toMatchObject({ sent: true, posted: true })
    posting.stop()
  })

  test("a send the channel refuses comes back the same way: the line below goes out alone, and the editor hears it (T1401)", async () => {
    const posts: string[] = []
    const heard: string[] = []
    const off = onGiveBack((block) => heard.push(block))
    let refuse = true
    let open: ((e: DocEvent) => void) | null = null
    const live = new LiveDoc(
      (_th, on) => {
        open = on
        return heldPipe().pipe
      },
      undefined,
      () => {},
      {
        me: "jow",
        post: (text) => {
          posts.push(text)
          return Promise.resolve(!refuse)
        },
      }
    )
    const id = start(live.doc, "jow", "ship it")
    const below = start(live.doc, "jow")
    const opened = open as ((e: DocEvent) => void) | null
    opened?.({ _tag: "Open", th: "th1" })
    await wait(0)
    expect(heard).toEqual([id])
    expect(inDoc(live.doc, id)).toBe(true)
    refuse = false
    type(live.doc, below, "next line")
    start(live.doc, "jow")
    await wait(0)
    expect(posts).toEqual(["ship it", "next line"])
    expect(inDoc(live.doc, id)).toBe(true)
    off()
    live.destroy()
  })
})
