import { describe, expect, test } from "bun:test"
import { EditorState, TextSelection, type PluginView, type Transaction } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"

import { parseCommand, type Command } from "~/chat/commands"
import { blocks, makeBlock } from "~/chat/doc/blocks"
import { docKeys, type DocKeyOpts } from "~/chat/doc/keys"
import { schema } from "~/chat/doc/schema"
import { suggestPlugin, type Query } from "~/chat/doc/suggest"

const T = 1_700_000_000_000

function doc(text: string, author = "jow", extra: DocKeyOpts = {}) {
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
      {
        commandFor: (line) => {
          const found = parseCommand(commands, line)
          return found ? () => found.command.run(found.args) : null
        },
        ...extra,
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
  const press = (key: string, mod = false) => {
    const e = { key, keyCode: key === "Enter" ? 13 : key === "ArrowUp" ? 38 : 0, shiftKey: false, altKey: false, ctrlKey: mod && !MAC, metaKey: mod && MAC } as KeyboardEvent
    return state.plugins.some((p) => p.props.handleKeyDown?.call(p, view, e) === true)
  }
  const typeText = (s: string) => host.dispatch(state.tr.insertText(s))
  const lines = () => blocks(state.doc).map((b) => b.node.textContent)
  const paragraphs = () => state.doc.child(0).childCount
  return { ran, press, typeText, lines, paragraphs, query: () => query }
}

const MAC = typeof navigator !== "undefined" && /Mac|iP(hone|[oa]d)/.test(navigator.platform)

describe("slash commands run from the thread doc (T1408)", () => {
  test("⌘/Ctrl+Enter on /compact runs it and clears your line, and nothing posts", () => {
    const d = doc("/compact")
    expect(d.press("Enter", true)).toBe(true)
    expect(d.ran).toEqual(["compact"])
    expect(d.lines()).toEqual([""])
  })

  test("the rest of the line is the command's argument", () => {
    const d = doc("/pause back after the deploy")
    d.press("Enter", true)
    expect(d.ran).toEqual(["pause:back after the deploy"])
  })

  test("an unknown /word, or a command later in the line, posts as a line", () => {
    for (const text of ["/shrug fine", "ship it /compact"]) {
      const d = doc(text)
      d.press("Enter", true)
      expect(d.ran).toEqual([])
      expect(d.lines()).toEqual([text, ""])
    }
  })

  test("Enter never runs a command or sends: it breaks your line, also on an empty line and on someone else's (T2565)", () => {
    for (const [text, author] of [
      ["/compact", "jow"],
      ["ship it", "jow"],
      ["", "jow"],
      ["her line", "maya"],
    ] as const) {
      const d = doc(text, author)
      expect(d.press("Enter")).toBe(true)
      expect(d.ran).toEqual([])
      expect(d.lines()).toEqual([text])
      expect(d.paragraphs()).toBe(2)
    }
  })

  test("someone else's line never runs your command", () => {
    const d = doc("/compact", "maya")
    d.press("Enter", true)
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

describe("the doc keeps the composer's ↑ and too-long check (T1418)", () => {
  test("↑ on your empty line edits your last message; on a line with words it doesn't", () => {
    let edits = 0
    const editLast = () => ++edits > 0
    expect(doc("", "jow", { editLast }).press("ArrowUp")).toBe(true)
    expect(edits).toBe(1)
    expect(doc("half a thought", "jow", { editLast }).press("ArrowUp")).toBe(false)
    expect(doc("", "maya", { editLast }).press("ArrowUp")).toBe(false)
    expect(edits).toBe(1)
  })

  test("↑ with nothing of yours to edit moves as usual", () => {
    expect(doc("", "jow", { editLast: () => false }).press("ArrowUp")).toBe(false)
  })

  test("⌘/Ctrl+Enter on a line that's too long keeps it as your draft instead of posting it", () => {
    const refused: string[] = []
    const refuse = (line: string) => line.length > 10 && refused.push(line) > 0
    const d = doc("this line is far too long", "jow", { refuse })
    expect(d.press("Enter", true)).toBe(true)
    expect(refused).toEqual(["this line is far too long"])
    expect(d.lines()).toEqual(["this line is far too long"])
    const short = doc("ship it", "jow", { refuse })
    short.press("Enter", true)
    expect(short.lines()).toEqual(["ship it", ""])
  })
})
