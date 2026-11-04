import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { agentBlock } from "@kiwi/core/doc/agent.ts"
import { blocksOf, markBack, markPosted, markSent, removeBlock, rewriteBlock } from "@kiwi/core/doc/blocks.ts"
import { EditorState, type Plugin, type PluginView, type Transaction } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { ySyncPlugin } from "y-prosemirror"

import { startBlock } from "~/chat/doc/blocks"
import { attrsOf, FRAGMENT, schema } from "~/chat/doc/schema"

const NET = Symbol("net")
const LINE = "Salve mister :)"

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

const texts = (doc: Y.Doc): string[] => blocksOf(doc).map((b) => b.text)

function lineStart(state: EditorState, id: string): number {
  let at = -1
  state.doc.forEach((node, offset) => {
    if (attrsOf(node).id === id) at = offset + 2
  })
  return at
}

async function authorAndDaemon() {
  const desk = new Y.Doc()
  const daemon = new Y.Doc()
  const sync = net(desk, daemon)
  const jow = editor(desk)
  await Promise.resolve()
  const said = agentBlock(daemon, "atlas", "agent")
  said.write("on it")
  said.post()
  sync()
  jow.dispatch(startBlock(jow.state(), "jow", 1))
  jow.dispatch(jow.state().tr.insertText(LINE))
  sync()
  const id = blocksOf(desk).find((b) => b.author === "jow")!.id
  const erase = (from: number, count: number): void => {
    const at = lineStart(jow.state(), id) + from
    jow.dispatch(jow.state().tr.delete(at, at + count))
  }
  const typeMore = (): void => {
    const at = lineStart(jow.state(), id)
    jow.dispatch(jow.state().tr.setSelection(jow.state().selection))
    jow.dispatch(jow.state().tr.insertText("!", at + jow.state().doc.resolve(at).parent.content.size))
  }
  return { desk, daemon, sync, jow, id, said, erase, typeMore }
}

describe("nothing but its author's editor puts letters back in a line the author deleted from (T1776)", () => {
  test("an agent streaming its own line while the author deletes in theirs", async () => {
    const { desk, daemon, sync, id, erase, typeMore } = await authorAndDaemon()
    erase(8, 4)
    const streaming = agentBlock(daemon, "atlas", "agent")
    for (const chunk of ["think", "ing ", "about it"]) {
      streaming.write(chunk)
      sync()
      typeMore()
    }
    streaming.end()
    sync()
    expect(blocksOf(desk).find((b) => b.id === id)?.text).toBe("Salve mi :)!!!")
    expect(texts(daemon)).toEqual(texts(desk))
  })

  test("a stale copy marking the line sent, posted or given back", async () => {
    for (const mark of [markSent, markPosted, markBack]) {
      const { desk, daemon, sync, id, erase, typeMore } = await authorAndDaemon()
      erase(8, 4)
      expect(mark(daemon, id)).toBe(true)
      sync()
      typeMore()
      sync()
      expect([mark.name, blocksOf(desk).find((b) => b.id === id)?.text]).toEqual([mark.name, "Salve mi :)!"])
      expect(texts(daemon)).toEqual(texts(desk))
    }
  })

  test("a stale copy editing the line while it's still a draft, or deleting another message", async () => {
    const { desk, daemon, sync, id, said, erase, typeMore } = await authorAndDaemon()
    erase(8, 4)
    expect(rewriteBlock(daemon, id, LINE)).toBe(false)
    expect(removeBlock(daemon, said.id)).toBe(true)
    sync()
    typeMore()
    sync()
    expect(texts(desk)).toEqual(["Salve mi :)!"])
    expect(texts(daemon)).toEqual(texts(desk))
  })

  test("a stale copy of the whole doc merged back in, as on a reload, a reopened doc or a reconnect", async () => {
    const { desk, daemon, sync, id, erase, typeMore } = await authorAndDaemon()
    const stale = Y.encodeStateAsUpdate(daemon)
    erase(8, 4)
    sync()
    const reopened = new Y.Doc()
    Y.applyUpdate(reopened, stale)
    Y.applyUpdate(daemon, Y.encodeStateAsUpdate(reopened))
    Y.applyUpdate(desk, Y.encodeStateAsUpdate(reopened))
    typeMore()
    sync()
    expect(blocksOf(desk).find((b) => b.id === id)?.text).toBe("Salve mi :)!")
    expect(texts(daemon)).toEqual(texts(desk))
  })
})
