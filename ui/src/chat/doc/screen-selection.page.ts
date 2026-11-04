import { EditorState } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { ySyncPlugin } from "y-prosemirror"
import * as Y from "yjs"

import { appendToBlock, newBlock } from "@kiwi/core/doc/blocks.ts"
import { keepScreenSelection, withScreenSelection } from "~/chat/doc/screen-selection"
import { FRAGMENT, schema } from "~/chat/doc/schema"

interface Race {
  mount: (line: string, wired: boolean) => void
  caretToEnd: () => void
  start: (gap: number) => void
  stop: () => void
  line: () => string
}

let busy = false
let there: Y.Doc | null = null
let other = ""

const race: Race = {
  mount: (line, wired) => {
    const here = new Y.Doc()
    there = new Y.Doc()
    there.on("update", (u: Uint8Array) => Y.applyUpdate(here, u))
    newBlock(there, "text", "jow", line)
    other = newBlock(there, "agent", "bot", "building").id
    const root = document.createElement("div")
    document.body.append(root)
    const view: EditorView = new EditorView(root, {
      state: EditorState.create({ schema, plugins: [ySyncPlugin(here.getXmlFragment(FRAGMENT))] }),
      dispatchTransaction(this: EditorView, tr) {
        this.updateState(this.state.apply(wired ? withScreenSelection(this, tr) : tr))
      },
    })
    if (wired) keepScreenSelection(view)
  },
  caretToEnd: () => {
    const p = document.querySelector("section p")
    const text = p?.lastChild
    if (!p || !text) throw new Error("the line isn't drawn yet")
    p.closest<HTMLElement>("[contenteditable]")?.focus()
    document.getSelection()?.collapse(text, text.textContent?.length ?? 0)
  },
  start: (gap) => {
    busy = true
    const tick = (): void => {
      if (!busy || !there) return
      appendToBlock(there, other, "x")
      setTimeout(tick, gap)
    }
    setTimeout(tick, gap)
  },
  stop: () => void (busy = false),
  line: () => document.querySelector("section p")?.textContent ?? "",
}

Object.assign(window, { race })
