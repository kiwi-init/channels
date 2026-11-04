import { describe, expect, test } from "bun:test"
import { EditorState, TextSelection, type PluginView, type Transaction } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"

import { parseCommand, type Command } from "~/chat/commands"
import { blocks, makeBlock } from "~/chat/doc/blocks"
import { docKeys } from "~/chat/doc/keys"
import { schema } from "~/chat/doc/schema"
import { suggestPlugin, type Query } from "~/chat/doc/suggest"

const T = 1_700_000_000_000

function doc(text: string, author = "jow") {
  const ran: string[] = []
  const commands: Command[] = [
    { name: "compact", summary: "", run: () => ran.push("compact") },
    { name: "pause", summary: "", args: "note", run: (note) => ran.push(`pause:${note}`) },
  ]
  let query: Query | null = null
  const plugins = [
    suggestPlugin(
      (q) => void (query = q),
      () => false
    ),
    ...docKeys(
      "jow",
      () => T,
      () => {},
      () => false,
      (line) => {
        const found = parseCommand(commands, line)
        return found ? () => found.command.run(found.args) : null
      }
    ),
  ]
  const start = EditorState.create({ schema, plugins, doc: schema.nodes.doc.create(null, [makeBlock("text", author, T, text)]) })
  let state = start.apply(start.tr.setSelection(TextSelection.atEnd(start.doc)))
  const views: PluginView[] = []
  const host = {
    get state() {
      return state
    },
    dispatch: (tr: Transaction) => {
      const prev = state
      state = state.apply(tr)
      for (const v of views) v.update?.(view, prev)
    },
  }
  const view = host as unknown as EditorView
  for (const p of plugins) {
    const made = p.spec.view?.(view)
    if (made) views.push(made)
  }
  const press = (key: string) => {
    const e = { key, keyCode: key === "Enter" ? 13 : 0, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false } as KeyboardEvent
    return state.plugins.some((p) => p.props.handleKeyDown?.call(p, view, e) === true)
  }
  const typeText = (s: string) => host.dispatch(state.tr.insertText(s))
  const lines = () => blocks(state.doc).map((b) => b.node.textContent)
  return { ran, press, typeText, lines, query: () => query }
}

describe("slash commands run from the thread doc (T1408)", () => {
  test("Enter on /compact runs it and clears your line, and nothing posts", () => {
    const d = doc("/compact")
    expect(d.press("Enter")).toBe(true)
    expect(d.ran).toEqual(["compact"])
    expect(d.lines()).toEqual([""])
  })

  test("the rest of the line is the command's argument", () => {
    const d = doc("/pause back after the deploy")
    d.press("Enter")
    expect(d.ran).toEqual(["pause:back after the deploy"])
  })

  test("an unknown /word, or a command later in the line, posts as a line", () => {
    for (const text of ["/shrug fine", "ship it /compact"]) {
      const d = doc(text)
      d.press("Enter")
      expect(d.ran).toEqual([])
      expect(d.lines()).toEqual([text, ""])
    }
  })

  test("someone else's line never runs your command", () => {
    const d = doc("/compact", "maya")
    d.press("Enter")
    expect(d.ran).toEqual([])
  })

  test("the menu opens on / at the start of your line, not in the middle", () => {
    const d = doc("")
    d.typeText("/co")
    expect(d.query()).toMatchObject({ kind: "/", text: "co" })
    d.typeText(" now /x")
    expect(d.query()).toBeNull()
  })
})
