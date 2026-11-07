import { describe, expect, jest, test } from "bun:test"
import * as Y from "yjs"
import { EditorState, type Plugin, type PluginView, type Transaction } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { ySyncPlugin } from "y-prosemirror"
import { attachToBlock, type BlockMedia } from "@kiwi/core/doc/blocks.ts"

import { blockAfter, startBlock } from "~/chat/doc/blocks"
import { holdDoc, LiveDoc } from "~/chat/doc/live"
import { postFinished, type Finished } from "~/chat/doc/post"
import { attrsOf, FRAGMENT, schema } from "~/chat/doc/schema"
import { afterUploads, startUpload } from "~/chat/doc/uploads"

interface Editor {
  state: () => EditorState
  dispatch: (tr: Transaction) => void
}

function editor(doc: Y.Doc): Editor {
  const sync: Plugin = ySyncPlugin(doc.getXmlFragment(FRAGMENT))
  let state = EditorState.create({ schema, plugins: [sync] })
  const views: PluginView[] = []
  const host = {
    get state() {
      return state
    },
    isDestroyed: false,
    hasFocus: () => false,
    dispatch: (tr: Transaction) => {
      const prev = state
      state = state.apply(tr)
      for (const v of views) v.update?.(view, prev)
    },
  }
  const view = host as unknown as EditorView
  const shown = sync.spec.view?.(view)
  if (shown) views.push(shown)
  return { state: () => state, dispatch: (tr) => host.dispatch(tr) }
}

const image = (n: number): BlockMedia => ({ image: { name: `shot-${n}.png`, mime: "image/png", ref: { id: `img${n}`.padEnd(32, "0"), key: "k".repeat(43), size: 100 } } })
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0))
const here = (e: Editor): string => attrsOf(e.state().doc.child(e.state().selection.$from.index(0))).id

function poster(doc: Y.Doc): Finished[] {
  const out: Finished[] = []
  postFinished(doc, { me: "jow", local: () => true, owned: () => true, hold: afterUploads }, (b) => out.push(b))
  return out
}

describe("a line waits for its upload and goes out with the image (#3001)", () => {
  test("typing, uploading and sending at once: the line waits for its upload and goes out with the image", async () => {
    const doc = new Y.Doc()
    const sent = poster(doc)
    const e = editor(doc)
    await settle()
    e.dispatch(startBlock(e.state(), "jow", 1))
    e.dispatch(e.state().tr.insertText("Album viu essa imagem ?"))
    const target = here(e)
    const done = startUpload(target)
    e.dispatch(blockAfter(e.state(), "jow", 3)!)
    await settle()
    expect(sent).toEqual([])
    e.dispatch(e.state().tr.insertText("next line"))
    expect(attachToBlock(doc, target, [image(1)])).toBe(true)
    done()
    await settle()
    expect(sent.map((s) => s.id)).toEqual([target])
    expect(sent[0]!.text).toContain("Album viu essa imagem ?")
    expect(sent[0]!.text).toContain("shot-1.png")
    expect(here(e)).not.toBe(target)
    const lines: string[] = []
    e.state().doc.forEach((n) => void lines.push(`${attrsOf(n).id === target ? "target" : "other"}:${n.childCount}:${n.textContent}`))
    expect(lines).toEqual(["target:2:Album viu essa imagem ?[image: shot-1.png]", "other:1:next line"])
  })

  test("the upload starts before the words: the text typed after it goes out with the image", async () => {
    const doc = new Y.Doc()
    const sent = poster(doc)
    const e = editor(doc)
    await settle()
    e.dispatch(startBlock(e.state(), "jow", 1))
    const target = here(e)
    const done = startUpload(target)
    e.dispatch(e.state().tr.insertText("olha isso"))
    e.dispatch(blockAfter(e.state(), "jow", 2)!)
    await settle()
    expect(sent).toEqual([])
    expect(attachToBlock(doc, target, [image(2)])).toBe(true)
    done()
    await settle()
    expect(sent.map((s) => s.id)).toEqual([target])
    expect(sent[0]!.text).toContain("olha isso")
    expect(sent[0]!.text).toContain("shot-2.png")
  })

  test("a line with no upload waiting goes out at once", async () => {
    const doc = new Y.Doc()
    const sent = poster(doc)
    const e = editor(doc)
    await settle()
    e.dispatch(startBlock(e.state(), "jow", 1))
    e.dispatch(e.state().tr.insertText("plain line"))
    e.dispatch(blockAfter(e.state(), "jow", 2)!)
    await settle()
    expect(sent.map((s) => s.text)).toEqual(["plain line"])
  })

  test("the thread closes before the upload finishes: the doc stays open, the image lands in its line and the line goes out with it", async () => {
    const posted: string[] = []
    const quiet = { update: () => {}, aware: () => {}, close: () => {} }
    const held = holdDoc(
      "closed-mid-upload",
      () =>
        new LiveDoc(
          (_, on) => (void Promise.resolve().then(() => on({ _tag: "Open", th: "th-closed" })), quiet),
          undefined,
          () => {},
          { me: "jow", post: (text) => (posted.push(text), Promise.resolve(true)) }
        )
    )
    const live = held.live
    let destroyed = false
    live.doc.on("destroy", () => void (destroyed = true))
    const e = editor(live.doc)
    await settle()
    e.dispatch(startBlock(e.state(), "jow", 1))
    e.dispatch(e.state().tr.insertText("olha a foto"))
    const target = here(e)
    const done = startUpload(target)
    e.dispatch(blockAfter(e.state(), "jow", 3)!)
    await settle()
    expect(posted).toEqual([])
    jest.useFakeTimers()
    try {
      held.release()
      jest.advanceTimersByTime(5 * 60_000)
      expect(destroyed).toBe(false)
      expect(attachToBlock(live.doc, target, [image(5)])).toBe(true)
      done()
      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(0)
        await Promise.resolve()
      }
      expect(posted).toHaveLength(1)
      expect(posted[0]).toContain("olha a foto")
      expect(posted[0]).toContain("shot-5.png")
      jest.advanceTimersByTime(60_000)
      expect(destroyed).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })
})
