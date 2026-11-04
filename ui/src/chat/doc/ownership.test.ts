import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { EditorState, type Plugin, type PluginView, type Transaction } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { ySyncPlugin } from "y-prosemirror"

import { startBlock } from "~/chat/doc/blocks"
import { attrsOf, FRAGMENT, schema } from "~/chat/doc/schema"
import { postFinished } from "~/chat/doc/post"

const NET = Symbol("net")

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

function net(a: Y.Doc, b: Y.Doc): () => void {
  const held: [Y.Doc, Uint8Array][] = []
  a.on("update", (u: Uint8Array, o: unknown) => o !== NET && held.push([b, u]))
  b.on("update", (u: Uint8Array, o: unknown) => o !== NET && held.push([a, u]))
  return () => held.splice(0).forEach(([to, u]) => Y.applyUpdate(to, u, NET))
}

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

function newLine(e: Editor, author: string, id: string, text: string): void {
  const line = schema.nodes.block!.create({ id, author, at: 3 }, schema.nodes.paragraph!.create(null, text ? schema.text(text) : null))
  e.dispatch(e.state().tr.insert(e.state().doc.content.size, line))
}

describe("a draft belongs to the window typing it, not to the person (T1776, @mighty-alpaca's probes)", () => {
  test("another window of yours starts its own line instead of taking over the draft you're typing", async () => {
    const desk = new Y.Doc()
    const peer = new Y.Doc()
    const sync = net(desk, peer)
    const a = editor(desk)
    const b = editor(peer)
    await Promise.resolve()
    a.dispatch(startBlock(a.state(), "jow", 1))
    a.dispatch(a.state().tr.insertText("active draft"))
    sync()
    const old = a.state().doc.child(a.state().selection.$from.index(0))
    const tr = startBlock(
      b.state(),
      "jow",
      2,
      () => false,
      () => false
    )
    const picked = tr.doc.child(tr.selection.$from.index(0))
    expect(attrsOf(picked).id).not.toBe(attrsOf(old).id)
  })

  test("a new line in another window of yours never posts the draft you're still typing", async () => {
    const desk = new Y.Doc()
    const peer = new Y.Doc()
    const sync = net(desk, peer)
    const a = editor(desk)
    const b = editor(peer)
    const sent: string[] = []
    const posting = postFinished(peer, { me: "jow", local: (origin) => origin !== NET }, (line) => sent.push(line.text))
    await Promise.resolve()
    newLine(a, "jow", "a-draft", "still typing")
    sync()
    newLine(b, "jow", "b-draft", "")
    await settle()
    posting.stop()
    expect(sent).toEqual([])
  })
})
