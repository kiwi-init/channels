import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { appendToBlock, blocksOf, newBlock } from "@kiwi/core/doc/blocks.ts"
import { EditorState, TextSelection, type Plugin, type PluginView, type Transaction } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { ySyncPlugin, ySyncPluginKey } from "y-prosemirror"

import { startBlock } from "~/chat/doc/blocks"
import { writeOwnLinesOnly } from "~/chat/doc/own-writes"
import { attrsOf, FRAGMENT, schema } from "~/chat/doc/schema"

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
  const own = guarded ? writeOwnLinesOnly(state, () => ({ state, dispatch: (tr) => host.dispatch(tr) })) : null
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

function lineStart(e: Editor, author: string): number {
  let at = -1
  e.state().doc.forEach((node, offset) => {
    if (attrsOf(node).author === author) at = offset + 2
  })
  return at
}

async function behindOn(line: string, missed: (e: Editor) => void) {
  const desk = new Y.Doc()
  const peer = new Y.Doc()
  const sync = net(desk, peer)
  const jow = editor(desk, true)
  const dad = editor(peer, true)
  await Promise.resolve()
  dad.dispatch(startBlock(dad.state(), "dad", 1))
  dad.dispatch(dad.state().tr.insertText("bom dia"))
  sync()
  jow.dispatch(startBlock(jow.state(), "jow", 2))
  jow.dispatch(jow.state().tr.insertText(line))
  sync()
  missed(jow)
  let once = true
  peer.on("update", (_u: Uint8Array, o: unknown) => {
    if (!once || o === NET) return
    once = false
    sync()
  })
  typeAtEnd(dad, "dad", "!")
  return { desk, peer, sync, jow, dad }
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

  test("a peer that missed new letters in a line it already drew redraws it, even without typing", async () => {
    const desk = new Y.Doc()
    const peer = new Y.Doc()
    const sync = net(desk, peer)
    const jow = editor(desk, true)
    const dad = editor(peer, true)
    await Promise.resolve()
    dad.dispatch(startBlock(dad.state(), "dad", 1))
    dad.dispatch(dad.state().tr.insertText("bom dia"))
    sync()
    jow.dispatch(startBlock(jow.state(), "jow", 2))
    jow.dispatch(jow.state().tr.insertText("Salve mister :)"))
    sync()
    typeAtEnd(jow, "jow", " NEW")
    let once = true
    peer.on("update", (_u: Uint8Array, o: unknown) => {
      if (!once || o === NET) return
      once = false
      sync()
    })
    typeAtEnd(dad, "dad", "!")
    await settle()
    expect(dad.state().doc.textContent).toBe("bom dia!Salve mister :) NEW")
    typeAtEnd(dad, "dad", "?")
    sync()
    await settle()
    expect(texts(desk)).toEqual(["dad: bom dia!?", "jow: Salve mister :) NEW"])
    expect(dad.state().doc.textContent).toBe("bom dia!?Salve mister :) NEW")
  })

  test("a peer that edits a line it's behind on sends only its own edit, so the letters it missed stay", async () => {
    const append = (e: Editor) => typeAtEnd(e, "jow", " NEW")
    const split = (e: Editor) => {
      const at = lineStart(e, "jow") + 2
      e.dispatch(
        e
          .state()
          .tr.split(at)
          .insertText("LOCAL", at + 2)
      )
    }
    const list = (e: Editor) => {
      const { nodes } = schema
      const item = nodes.list_item!.create(null, nodes.paragraph!.create(null, schema.text("item")))
      e.dispatch(e.state().tr.insert(lineStart(e, "jow") + 6, nodes.bullet_list!.create(null, item)))
    }
    const mention = (name: string) => schema.nodes.mention!.create({ name })
    const replace = (e: Editor) => e.dispatch(e.state().tr.insertText("p", lineStart(e, "jow") + 3, lineStart(e, "jow") + 5))
    for (const [what, missed, edit, want] of [
      ["types at the end", append, (e: Editor) => typeAtEnd(e, "jow", "?"), "hello NEW?"],
      ["deletes at the start", append, (e: Editor) => e.dispatch(e.state().tr.delete(lineStart(e, "jow"), lineStart(e, "jow") + 2)), "llo NEW"],
      ["retypes a span the other side left alone", append, (e: Editor) => e.dispatch(e.state().tr.insertText("y", lineStart(e, "jow") + 2, lineStart(e, "jow") + 5)), "hey NEW"],
      ["retypes the span the other side changed: it adds, never cuts", replace, (e: Editor) => e.dispatch(e.state().tr.insertText("y", lineStart(e, "jow") + 2, lineStart(e, "jow") + 5)), "heylp"],
      ["splits the line in two", append, split, "he\nLOCALllo NEW"],
      ["adds a mention", append, (e: Editor) => e.dispatch(e.state().tr.insert(lineStart(e, "jow"), mention("ana"))), "@anahello NEW"],
      ["types in a line whose missed change is a list", list, (e: Editor) => e.dispatch(e.state().tr.insertText("X", lineStart(e, "jow"))), "Xhello\nitem"],
      [
        "types in a line whose missed change is a mention",
        (e: Editor) => e.dispatch(e.state().tr.insert(lineStart(e, "jow") + 5, mention("ana"))),
        (e: Editor) => e.dispatch(e.state().tr.insertText("X", lineStart(e, "jow"))),
        "Xhello@ana",
      ],
    ] as const) {
      const { desk, peer, sync, dad } = await behindOn("hello", missed)
      edit(dad)
      sync()
      await settle()
      expect([what, texts(desk)]).toEqual([what, ["dad: bom dia!", `jow: ${want}`]])
      expect(texts(peer)).toEqual(texts(desk))
      expect([what, dad.state().doc.textContent]).toEqual([what, `bom dia!${want.replace("\n", "")}`])
    }
  })

  test("a line with no id (a fresh doc's first line) doesn't turn the guard off for the rest", async () => {
    const desk = new Y.Doc()
    const peer = new Y.Doc()
    const sync = net(desk, peer)
    const jow = editor(desk, true)
    const dad = editor(peer, true)
    await Promise.resolve()
    newLine(jow, "jow", "jow-draft", "hello")
    newLine(jow, "dad", "dad-draft", "other")
    sync()
    typeAtEnd(jow, "jow", " NEW")
    let once = true
    peer.on("update", (_u: Uint8Array, o: unknown) => {
      if (!once || o === NET) return
      once = false
      sync()
    })
    typeAtEnd(dad, "dad", "!")
    typeAtEnd(dad, "jow", "?")
    sync()
    await settle()
    expect(texts(desk)).toContain("jow: hello NEW?")
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

  test("a redraw keeps your caret and selection where they were in your line, even when a line lands above or letters land before them", async () => {
    const select = (e: Editor, from: number, to: number) => e.dispatch(e.state().tr.setSelection(TextSelection.create(e.state().doc, from, to)))
    const typeHere = (e: Editor, text: string) => e.dispatch(e.state().tr.insertText(text))
    const lineAbove = (e: Editor) => {
      const line = schema.nodes.block!.create({ id: "jow-top", author: "jow", at: 0 }, schema.nodes.paragraph!.create(null, schema.text("jow line")))
      e.dispatch(e.state().tr.insert(0, line))
    }
    const lettersBefore = (e: Editor) => e.dispatch(e.state().tr.insertText("XX", lineStart(e, "dad")))
    const pasted = (e: Editor) => {
      e.dispatch(e.state().tr.insertText("Y".repeat(2001), lineStart(e, "dad") + 5))
      e.dispatch(e.state().tr.insertText("X".repeat(2001), lineStart(e, "dad")))
    }
    const lettersAround = (e: Editor) => {
      e.dispatch(e.state().tr.insertText("YY", lineStart(e, "dad") + 5))
      lettersBefore(e)
    }
    for (const [what, missed, from, to, want] of [
      ["a caret under a line that lands above", lineAbove, 4, 4, ["jow: jow line", "dad: bom ?¿dia!"]],
      ["a selection under a line that lands above", lineAbove, 4, 6, ["jow: jow line", "dad: bom ?¿a!"]],
      ["a caret after letters that land before it in your line", lettersBefore, 3, 3, ["dad: XXbom?¿ dia!"]],
      ["a selection after letters that land before it in your line", lettersBefore, 0, 3, ["dad: XX?¿ dia!"]],
      ["a caret between two separate edits in your line", lettersAround, 3, 3, ["dad: XXbom?¿ dYYia!"]],
      ["a selection between two separate edits in your line", lettersAround, 1, 3, ["dad: XXb?¿ dYYia!"]],
      ["a caret between two pastes of 2001 letters each", pasted, 3, 3, [`dad: ${"X".repeat(2001)}bom?¿ d${"Y".repeat(2001)}ia!`]],
      ["a selection between two pastes of 2001 letters each", pasted, 1, 3, [`dad: ${"X".repeat(2001)}b?¿ d${"Y".repeat(2001)}ia!`]],
    ] as const) {
      const desk = new Y.Doc()
      const peer = new Y.Doc()
      const sync = net(desk, peer)
      const jow = editor(desk, true)
      const dad = editor(peer, true)
      await Promise.resolve()
      dad.dispatch(startBlock(dad.state(), "dad", 1))
      dad.dispatch(dad.state().tr.insertText("bom dia"))
      sync()
      await settle()
      missed(jow)
      const at = lineStart(dad, "dad")
      select(dad, at + from, at + to)
      let once = true
      peer.on("update", (_u: Uint8Array, o: unknown) => {
        if (!once || o === NET) return
        once = false
        sync()
      })
      const end = lineStart(dad, "dad") + dad.state().doc.child(dad.state().doc.childCount - 1).content.size - 2
      dad.dispatch(dad.state().tr.insert(end, schema.text("!")))
      await settle()
      expect([what, dad.state().selection.empty]).toEqual([what, from === to])
      typeHere(dad, "?")
      await settle()
      typeHere(dad, "¿")
      sync()
      await settle()
      expect([what, texts(desk)]).toEqual([what, want])
      expect(texts(peer)).toEqual(texts(desk))
    }
  })

  test("in a line of repeated letters, a redraw after big pastes keeps a valid caret in your line", async () => {
    const a = "a".repeat(80)
    const r = (c: string, n: number) => c.repeat(n)
    for (const [what, pastes, want] of [
      [
        "two pastes around the caret, within reach of the diff",
        [
          [79, "Y", 600],
          [0, "X", 600],
        ],
        `${r("X", 600)}${r("a", 30)}?¿${r("a", 49)}${r("Y", 600)}a!`,
      ],
      [
        "two pastes of 1500 around the caret",
        [
          [50, "Y", 1500],
          [0, "X", 1500],
        ],
        `${r("X", 1500)}${r("a", 30)}?¿${r("a", 20)}${r("Y", 1500)}${r("a", 30)}!`,
      ],
      [
        "three pastes and no unique context: the end of your line",
        [
          [50, "Y", 1500],
          [20, "Z", 1500],
          [0, "X", 1500],
        ],
        `${r("X", 1500)}${r("a", 20)}${r("Z", 1500)}${r("a", 30)}${r("Y", 1500)}${r("a", 30)}!?¿`,
      ],
    ] as const) {
      const desk = new Y.Doc()
      const peer = new Y.Doc()
      const sync = net(desk, peer)
      const jow = editor(desk, true)
      const dad = editor(peer, true)
      await Promise.resolve()
      dad.dispatch(startBlock(dad.state(), "dad", 1))
      dad.dispatch(dad.state().tr.insertText(a))
      sync()
      await settle()
      for (const [at, c, n] of pastes) jow.dispatch(jow.state().tr.insertText(r(c, n), lineStart(jow, "dad") + at))
      const start = lineStart(dad, "dad")
      dad.dispatch(dad.state().tr.setSelection(TextSelection.create(dad.state().doc, start + 30)))
      let once = true
      peer.on("update", (_u: Uint8Array, o: unknown) => {
        if (!once || o === NET) return
        once = false
        sync()
      })
      dad.dispatch(dad.state().tr.insert(start + a.length, schema.text("!")))
      await settle()
      expect([what, dad.state().selection.$head.parent.inlineContent]).toEqual([what, true])
      dad.dispatch(dad.state().tr.insertText("?"))
      await settle()
      dad.dispatch(dad.state().tr.insertText("¿"))
      sync()
      await settle()
      expect([what, texts(desk)]).toEqual([what, [`dad: ${want}`]])
      expect(texts(peer)).toEqual(texts(desk))
    }
  })

  test("a new line next to a changed one never takes over another line's place in the doc, so an agent's letters stay in its own line", async () => {
    const elementOf = (doc: Y.Doc, id: string) =>
      doc
        .getXmlFragment(FRAGMENT)
        .toArray()
        .find((el) => el instanceof Y.XmlElement && el.getAttribute("id") === id)
    for (const [what, guarded, before] of [
      ["guarded", true, null],
      ["guarded, after a synced line with no id", true, "unnamed"],
      ["unguarded", false, null],
    ] as const) {
      const agentDoc = new Y.Doc()
      const desk = new Y.Doc()
      const sync = net(agentDoc, desk)
      const jow = editor(desk, guarded)
      await Promise.resolve()
      if (before) {
        const unnamed = new Y.XmlElement("block")
        unnamed.insert(0, [new Y.XmlElement("paragraph")])
        agentDoc.getXmlFragment(FRAGMENT).insert(0, [unnamed])
      }
      const a = newBlock(agentDoc, "text", "agent", "step 1")
      sync()
      await settle()
      const agentLine = elementOf(desk, a.id)
      appendToBlock(agentDoc, a.id, " of 3")
      const line = schema.nodes.block!.create({ id: "jow-new", author: "jow", at: 5 }, schema.nodes.paragraph!.create(null, schema.text("ugzyw")))
      const at = before ? jow.state().doc.child(0).nodeSize : 0
      const end = at + jow.state().doc.child(before ? 1 : 0).nodeSize - 2
      jow.dispatch(jow.state().tr.insertText("!", end).insert(at, line))
      sync()
      await settle()
      const lines = texts(desk).filter((l) => l !== ": ")
      if (!guarded) {
        expect([what, lines]).not.toContain("jow: ugzyw")
        continue
      }
      expect([what, lines.length, lines.includes("jow: ugzyw")]).toEqual([what, 2, true])
      const theirs = lines.find((l) => l.startsWith("agent: "))!
      expect([what, theirs.includes(" of 3"), theirs.includes("!")]).toEqual([what, true, true])
      expect([what, elementOf(desk, a.id) === agentLine, agentLine instanceof Y.XmlElement && agentLine.getAttribute("author")]).toEqual([what, true, "agent"])
      expect(texts(agentDoc)).toEqual(texts(desk))
    }
  })

  test("a line deleted elsewhere while you were out of step stays deleted when you write", async () => {
    const agentDoc = new Y.Doc()
    const desk = new Y.Doc()
    const sync = net(agentDoc, desk)
    const jow = editor(desk, true)
    await Promise.resolve()
    const a = newBlock(agentDoc, "text", "agent", "temporary")
    newBlock(agentDoc, "text", "agent", "stays")
    sync()
    await settle()
    const frag = agentDoc.getXmlFragment(FRAGMENT)
    frag.delete(
      frag.toArray().findIndex((el) => el instanceof Y.XmlElement && el.getAttribute("id") === a.id),
      1
    )
    const line = schema.nodes.block!.create({ id: "jow-new", author: "jow", at: 5 }, schema.nodes.paragraph!.create(null, schema.text("hi")))
    jow.dispatch(
      jow
        .state()
        .tr.insertText("!", jow.state().doc.child(0).nodeSize - 2)
        .insert(0, line)
    )
    sync()
    await settle()
    expect(texts(desk).sort()).toEqual(["agent: stays", "jow: hi"])
    expect(texts(agentDoc).sort()).toEqual(texts(desk).sort())
  })
})
