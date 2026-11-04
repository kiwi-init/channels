import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { blocksOf } from "@kiwi/core/doc/blocks.ts"
import { EditorState, type Plugin, type PluginView, type Transaction } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { ySyncPlugin } from "y-prosemirror"

import { dropEmptyOwn, noteMade, startBlock } from "~/chat/doc/blocks"
import type { MadeLines } from "~/chat/doc/made"
import { FRAGMENT, schema } from "~/chat/doc/schema"

const NET = Symbol("net")

interface Copy {
  state: () => EditorState
  dispatch: (tr: Transaction | null) => void
  mine: (block: string) => boolean
}

function copy(doc: Y.Doc, made: MadeLines = new Set<string>()): Copy {
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
      if (tr.docChanged && !tr.getMeta("y-sync$")) noteMade(prev.doc, state.doc, "jow", made)
      for (const v of views) v.update?.(view, prev)
    },
  }
  const view = host as unknown as EditorView
  const shown = sync.spec.view?.(view)
  if (shown) views.push(shown)
  return { state: () => state, dispatch: (tr) => tr && host.dispatch(tr), mine: (block) => made.has(block) }
}

function net(a: Y.Doc, b: Y.Doc): () => void {
  const held: [Y.Doc, Uint8Array][] = []
  a.on("update", (u: Uint8Array, o: unknown) => o !== NET && held.push([b, u]))
  b.on("update", (u: Uint8Array, o: unknown) => o !== NET && held.push([a, u]))
  return () => held.splice(0).forEach(([to, u]) => Y.applyUpdate(to, u, NET))
}

const texts = (doc: Y.Doc): string[] => blocksOf(doc).map((b) => b.text)

async function twoCopies() {
  const desk = new Y.Doc()
  const phone = new Y.Doc()
  const sync = net(desk, phone)
  const a = copy(desk)
  const b = copy(phone)
  await Promise.resolve()
  a.dispatch(startBlock(a.state(), "atlas", 0))
  a.dispatch(a.state().tr.insertText("merged #12"))
  sync()
  return { desk, phone, sync, a, b }
}

describe("two copies of one person's doc never erase each other's typing (T1776)", () => {
  test("a copy's cleanup leaves alone an empty line another copy made, so the letters typed into it stay", async () => {
    const { desk, phone, sync, a, b } = await twoCopies()
    a.dispatch(startBlock(a.state(), "jow", 1, undefined, a.mine))
    sync()
    a.dispatch(a.state().tr.insertText("não apaga isso"))
    b.dispatch(dropEmptyOwn(b.state(), "jow", null, b.mine))
    sync()
    expect(texts(desk)).toEqual(["merged #12", "não apaga isso"])
    expect(texts(phone)).toEqual(["merged #12", "não apaga isso"])
  })

  test("a copy starts its own line instead of typing into another copy's empty one, so that copy's cleanup can't take it", async () => {
    const { desk, phone, sync, a, b } = await twoCopies()
    b.dispatch(startBlock(b.state(), "jow", 1, undefined, b.mine))
    sync()
    a.dispatch(startBlock(a.state(), "jow", 2, undefined, a.mine))
    a.dispatch(a.state().tr.insertText("digitando"))
    b.dispatch(dropEmptyOwn(b.state(), "jow", null, b.mine))
    sync()
    expect(texts(desk)).toEqual(["merged #12", "digitando"])
    expect(texts(phone)).toEqual(["merged #12", "digitando"])
  })

  test("a copy still tidies away its own empty lines", async () => {
    const { desk, sync, a } = await twoCopies()
    a.dispatch(startBlock(a.state(), "jow", 1, undefined, a.mine))
    expect(texts(desk)).toEqual(["merged #12", ""])
    a.dispatch(dropEmptyOwn(a.state(), "jow", null, a.mine))
    sync()
    expect(texts(desk)).toEqual(["merged #12"])
  })

  test("a window opened or reloaded after another made a line never takes it as its own, even with that window's storage", async () => {
    const storage = (from?: Storage): Storage => {
      const kept = new Map<string, string>()
      for (let i = 0; from && i < from.length; i++) {
        const k = from.key(i)
        if (k !== null) kept.set(k, from.getItem(k) ?? "")
      }
      return {
        get length() {
          return kept.size
        },
        clear: () => kept.clear(),
        getItem: (k) => kept.get(k) ?? null,
        key: (i) => [...kept.keys()][i] ?? null,
        removeItem: (k) => void kept.delete(k),
        setItem: (k, v) => void kept.set(k, v),
      }
    }
    const before = { local: globalThis.localStorage, session: globalThis.sessionStorage }
    const shared = storage()
    const windowA = storage()
    const load = async (session: Storage, name: string): Promise<MadeLines> => {
      Object.assign(globalThis, { localStorage: shared, sessionStorage: session })
      const fresh: typeof import("~/chat/doc/made") = await import(`~/chat/doc/made?window=${name}`)
      return fresh.madeHere
    }
    try {
      for (const opened of ["empty", "cloned"]) {
        const desk = new Y.Doc()
        const phone = new Y.Doc()
        const sync = net(desk, phone)
        const a = copy(desk, await load(windowA, `a-${opened}`))
        a.dispatch(startBlock(a.state(), "atlas", 0))
        a.dispatch(a.state().tr.insertText("merged #12"))
        a.dispatch(startBlock(a.state(), "jow", 1, undefined, a.mine))
        const b = copy(phone, await load(opened === "cloned" ? storage(windowA) : storage(), `b-${opened}`))
        await Promise.resolve()
        sync()
        a.dispatch(a.state().tr.insertText("must survive"))
        b.dispatch(dropEmptyOwn(b.state(), "jow", null, b.mine))
        sync()
        expect([opened, texts(desk)]).toEqual([opened, ["merged #12", "must survive"]])
        expect([opened, texts(phone)]).toEqual([opened, ["merged #12", "must survive"]])
      }
    } finally {
      Object.assign(globalThis, { localStorage: before.local, sessionStorage: before.session })
    }
  })
})
