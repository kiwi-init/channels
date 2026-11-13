import { describe, expect, test } from "bun:test"

import { leafOf, savedLayouts, type Leaf } from "~/panes/store"

const main = { kind: "leaf", id: "main", nav: null }
const saved = (doc: unknown) =>
  JSON.stringify({
    c1: {
      root: { kind: "split", id: "split-1", dir: "row", ratio: 0.6, a: main, b: { kind: "leaf", id: "pane-2", nav: { where: { kind: "room", room: "general" } }, doc } },
      focus: "pane-2",
      typing: "main",
    },
  })

describe("saved layouts from before Home was removed (#3713)", () => {
  for (const doc of [{ kind: "home" }, { kind: "home", only: "c2" }, { kind: "gone-kind" }])
    test(`a saved ${JSON.stringify(doc)} pane opens blank and the layout keeps its shape`, () => {
      const layout = savedLayouts(saved(doc)).get("c1")
      expect(layout?.focus).toBe("pane-2")
      expect(layout?.typing).toBe("main")
      expect(layout && leafOf(layout.root, "main")).not.toBeNull()
      expect((layout && (leafOf(layout.root, "pane-2") as Leaf | null))?.doc).toEqual({ kind: "blank" })
    })

  test("a saved Now pane keeps its doc", () => {
    const layout = savedLayouts(saved({ kind: "now" })).get("c1")
    expect((layout && leafOf(layout.root, "pane-2"))?.doc).toEqual({ kind: "now" })
  })
})
