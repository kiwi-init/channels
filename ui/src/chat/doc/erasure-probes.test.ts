import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { blocksOf } from "@kiwi/core/doc/blocks.ts"
import { EditorState, type Plugin, type PluginView, type Transaction } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { ySyncPlugin, ySyncPluginKey } from "y-prosemirror"

import { startBlock } from "~/chat/doc/blocks"
import { writeOwnLinesOnly } from "~/chat/doc/own-writes"
import { attrsOf, FRAGMENT, schema } from "~/chat/doc/schema"
import { postFinished } from "~/chat/doc/post"

const NET = Symbol("net")

interface Editor {
  state: () => EditorState
  dispatch: (tr: Transaction) => void
}

const remote = (tr: Transaction): boolean => {
  const meta: unknown = tr.getMeta(ySyncPluginKey)
  return !!meta && typeof meta === "object" && "isChangeOrigin" in meta && !!meta.isChangeOrigin
}

function editor(doc: Y.Doc, guarded: boolean): Editor {
  const sync: Plugin = ySyncPlugin(doc.getXmlFragment(FRAGMENT))
  let state = EditorState.create({ schema, plugins: [sync] })
  const own = guarded ? writeOwnLinesOnly(state, () => state.doc) : null
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
      if (tr.docChanged && !remote(tr)) own?.touched(prev.doc, state.doc)
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

const texts = (doc: Y.Doc): string[] => blocksOf(doc).map((b) => `${b.author}: ${b.text}`)
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

function typeAtEnd(e: Editor, author: string, text: string): void {
  let end = -1
  e.state().doc.forEach((node, offset) => {
    if (attrsOf(node).author === author) end = offset + node.nodeSize - 2
  })
  e.dispatch(e.state().tr.insertText(text, end))
}

function newLine(e: Editor, author: string, id: string, text: string): void {
  const line = schema.nodes.block!.create({ id, author, at: 3 }, schema.nodes.paragraph!.create(null, text ? schema.text(text) : null))
  e.dispatch(e.state().tr.insert(e.state().doc.content.size, line))
}

async function outOfStep(guarded: boolean) {
  const desk = new Y.Doc()
  const peer = new Y.Doc()
  const sync = net(desk, peer)
  const jow = editor(desk, guarded)
  const dad = editor(peer, guarded)
  await Promise.resolve()
  dad.dispatch(startBlock(dad.state(), "dad", 1))
  dad.dispatch(dad.state().tr.insertText("bom dia"))
  sync()
  jow.dispatch(startBlock(jow.state(), "jow", 2))
  jow.dispatch(jow.state().tr.insertText("Salve mister :)"))
  let once = true
  peer.on("update", (_u: Uint8Array, o: unknown) => {
    if (!once || o === NET) return
    once = false
    sync()
  })
  typeAtEnd(dad, "dad", "!")
  return { desk, peer, sync, jow, dad }
}

describe("an editor writes only the lines it changed, so a peer out of step never erases yours (T1776)", () => {
  test("review: a guarded client cannot stop an old peer from deleting its draft", async () => {
    const desk = new Y.Doc()
    const peer = new Y.Doc()
    const sync = net(desk, peer)
    const a = editor(desk, true)
    const b = editor(peer, false)
    await Promise.resolve()
    b.dispatch(startBlock(b.state(), "dad", 1))
    b.dispatch(b.state().tr.insertText("other"))
    sync()
    a.dispatch(startBlock(a.state(), "jow", 2))
    a.dispatch(a.state().tr.insertText("must survive"))
    let once = true
    peer.on("update", (_u: Uint8Array, origin: unknown) => {
      if (!once || origin === NET) return
      once = false
      sync()
    })
    typeAtEnd(b, "dad", "!")
    typeAtEnd(b, "dad", "?")
    sync()
    await settle()
    expect(texts(desk)).toContain("jow: must survive")
  })

  test("review: a different window does not adopt an existing nonempty draft", async () => {
    const desk = new Y.Doc()
    const peer = new Y.Doc()
    const sync = net(desk, peer)
    const a = editor(desk, true)
    const b = editor(peer, true)
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
  test("review: changing a stale known line preserves newer peer text in the same line", async () => {
    const desk = new Y.Doc()
    const peer = new Y.Doc()
    const sync = net(desk, peer)
    const a = editor(desk, true)
    const b = editor(peer, true)
    await Promise.resolve()
    newLine(a, "jow", "jow-draft", "hello")
    newLine(a, "dad", "dad-draft", "other")
    sync()
    typeAtEnd(a, "jow", " NEW")
    let once = true
    peer.on("update", (_u: Uint8Array, origin: unknown) => {
      if (!once || origin === NET) return
      once = false
      sync()
    })
    typeAtEnd(b, "dad", "!")
    typeAtEnd(b, "jow", "?")
    sync()
    await settle()
    expect(texts(desk)).toContain("jow: hello NEW?")
    expect(texts(peer)).toEqual(texts(desk))
  })

  test("review: a new local line must not post another windows active draft", async () => {
    const desk = new Y.Doc()
    const peer = new Y.Doc()
    const sync = net(desk, peer)
    const a = editor(desk, true)
    const b = editor(peer, true)
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
  test("a peer that never drew your new line, typing in its own, leaves your line and its letters alone", async () => {
    const { desk, peer, sync, jow, dad } = await outOfStep(true)
    typeAtEnd(dad, "dad", "?")
    typeAtEnd(jow, "jow", " oi")
    sync()
    await settle()
    typeAtEnd(dad, "dad", ".")
    sync()
    expect(texts(desk)).toEqual(["dad: bom dia!?.", "jow: Salve mister :) oi"])
    expect(texts(peer)).toEqual(texts(desk))
    expect(dad.state().doc.textContent).toBe("bom dia!?.Salve mister :) oi")
  })

  test("a peer out of step that starts a new line of its own leaves your undrawn line in place", async () => {
    const { desk, peer, sync, dad } = await outOfStep(true)
    newLine(dad, "dad", "dad-2", "e aí")
    sync()
    await settle()
    expect(texts(desk)).toEqual(["dad: bom dia!", "dad: e aí", "jow: Salve mister :)"])
    expect(texts(peer)).toEqual(texts(desk))
  })

  test("without the guard, the out-of-step peer erases your line", async () => {
    const { desk, sync, dad } = await outOfStep(false)
    newLine(dad, "dad", "dad-2", "e aí")
    sync()
    expect(texts(desk)).not.toContain("jow: Salve mister :)")
  })

  test("your own edits, new lines and deleted lines still reach the doc", async () => {
    const doc = new Y.Doc()
    const me = editor(doc, true)
    await Promise.resolve()
    me.dispatch(startBlock(me.state(), "jow", 1))
    me.dispatch(me.state().tr.insertText("one"))
    newLine(me, "jow", "two", "two")
    expect(texts(doc)).toEqual(["jow: one", "jow: two"])
    const first = me.state().doc.child(0)
    me.dispatch(me.state().tr.delete(0, first.nodeSize))
    typeAtEnd(me, "jow", "!")
    expect(texts(doc)).toEqual(["jow: two!"])
  })
})
