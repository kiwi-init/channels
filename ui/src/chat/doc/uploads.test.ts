import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { EditorState, TextSelection, type Plugin, type PluginView, type Transaction } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { ySyncPlugin } from "y-prosemirror"

import { blockAfter, startBlock } from "~/chat/doc/blocks"
import { postFinished, type Finished } from "~/chat/doc/post"
import { attrsOf, FRAGMENT, imageNode, schema } from "~/chat/doc/schema"
import { afterUploads, attachTo, startUpload, uploadTarget } from "~/chat/doc/uploads"

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

const image = (n: number) => imageNode({ name: `shot-${n}.png`, mime: "image/png", ref: { id: `img${n}`.padEnd(32, "0"), key: "k".repeat(43), size: 100 } })
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0))
const here = (e: Editor): string => attrsOf(e.state().doc.child(e.state().selection.$from.index(0))).id

function poster(doc: Y.Doc): Finished[] {
  const out: Finished[] = []
  postFinished(doc, { me: "jow", local: () => true, owned: () => true, hold: afterUploads }, (b) => out.push(b))
  return out
}

describe("a pasted image goes out with the line it was pasted in (#3001)", () => {
  test("typing, pasting and sending at once: the line waits for its upload and goes out with the image", async () => {
    const doc = new Y.Doc()
    const sent = poster(doc)
    const e = editor(doc)
    await settle()
    e.dispatch(startBlock(e.state(), "jow", 1))
    e.dispatch(e.state().tr.insertText("Album viu essa imagem ?"))
    const target = uploadTarget(e.state(), "jow", 2, () => true)
    expect(target.tr).toBeNull()
    const done = startUpload(target.id)
    e.dispatch(blockAfter(e.state(), "jow", 3)!)
    await settle()
    expect(sent).toEqual([])
    e.dispatch(e.state().tr.insertText("next line"))
    e.dispatch(attachTo(e.state(), "jow", target.id, [image(1)])!)
    done()
    await settle()
    expect(sent.map((s) => s.id)).toEqual([target.id])
    expect(sent[0]!.text).toContain("Album viu essa imagem ?")
    expect(sent[0]!.text).toContain("shot-1.png")
    expect(here(e)).not.toBe(target.id)
    const lines: string[] = []
    e.state().doc.forEach((n) => void lines.push(`${attrsOf(n).id === target.id ? "target" : "other"}:${n.childCount}:${n.textContent}`))
    expect(lines).toEqual(["target:3:Album viu essa imagem ?[image: shot-1.png]", "other:1:next line"])
  })

  test("pasting first makes the line the image goes to, and the text typed after it goes out with it", async () => {
    const doc = new Y.Doc()
    const sent = poster(doc)
    const e = editor(doc)
    await settle()
    const target = uploadTarget(e.state(), "jow", 1, () => true)
    e.dispatch(target.tr!)
    const done = startUpload(target.id)
    e.dispatch(e.state().tr.insertText("olha isso"))
    e.dispatch(blockAfter(e.state(), "jow", 2)!)
    await settle()
    expect(sent).toEqual([])
    e.dispatch(attachTo(e.state(), "jow", target.id, [image(2)])!)
    done()
    await settle()
    expect(sent.map((s) => s.id)).toEqual([target.id])
    expect(sent[0]!.text).toContain("olha isso")
    expect(sent[0]!.text).toContain("shot-2.png")
  })

  test("an image never lands in someone else's line, nor in a line already sent", async () => {
    const doc = new Y.Doc()
    const e = editor(doc)
    await settle()
    const theirs = schema.nodes.block!.create({ id: "maya-line", author: "maya", at: 1 }, schema.nodes.paragraph!.create(null, schema.text("maya typing")))
    e.dispatch(e.state().tr.insert(e.state().doc.content.size, theirs))
    let at = 0
    e.state().doc.forEach((n, offset) => void (attrsOf(n).id === "maya-line" && (at = offset + 3)))
    e.dispatch(e.state().tr.setSelection(TextSelection.create(e.state().doc, at)))
    expect(here(e)).toBe("maya-line")
    const target = uploadTarget(e.state(), "jow", 2, () => true)
    expect(target.id).not.toBe("maya-line")
    expect(attachTo(e.state(), "jow", "maya-line", [image(3)])).toBeNull()
    const sentLine = schema.nodes.block!.create({ id: "sent-line", author: "jow", at: 1, sent: "1" }, schema.nodes.paragraph!.create(null, schema.text("done")))
    e.dispatch(e.state().tr.insert(e.state().doc.content.size, sentLine))
    expect(attachTo(e.state(), "jow", "sent-line", [image(4)])).toBeNull()
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
})
