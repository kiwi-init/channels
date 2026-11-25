import { describe, expect, test } from "bun:test"

import type { Step } from "~/panes/history"
import { keep, pastOf, smartSpot, spotsOf } from "~/panes/smart"
import type { Node } from "~/panes/store"

const step = (at: number, more: Partial<Step>): Step => ({ at, code: "c", act: "open", by: "app", pane: "pane-2", what: "task", screen: { w: 1500, h: 900 }, panes: [], ...more })

const seen = {
  screen: { w: 1500, h: 900 },
  panes: [
    { pane: "main", what: "room", x: 0, y: 0, w: 0.6, h: 1 },
    { pane: "pane-2", what: "now", x: 0.8, y: 0, w: 0.2, h: 1 },
    { pane: "pane-3", what: "blank", x: 0.6, y: 0, w: 0.2, h: 1 },
  ],
}

const root: Node = { kind: "split", id: "split-1", dir: "row", ratio: 0.6, a: { kind: "leaf", id: "main", nav: null }, b: { kind: "leaf", id: "pane-2", nav: null } }

describe("smart tiling", () => {
  test("spots are the edges a pane has room to split on, never a blank pane, and the app's own spot is marked", () => {
    expect(spotsOf(seen)).toEqual([
      { pane: "main", edge: "left" },
      { pane: "main", edge: "right", usual: true },
      { pane: "main", edge: "top" },
      { pane: "main", edge: "bottom" },
      { pane: "pane-2", edge: "top" },
      { pane: "pane-2", edge: "bottom" },
    ])
  })

  test("a placement the person moved soon after carries where they moved it, and the move isn't listed again", () => {
    const placed = step(0, { target: "room", edge: "right" })
    const moved = step(3000, { act: "move", by: "hand", target: "now", edge: "bottom" })
    const kept = step(60_000, { pane: "pane-4", what: "panel:pr", target: "room", edge: "right" })
    expect(pastOf([placed, moved, kept])).toEqual([
      { what: "task", by: "app", beside: "room", edge: "right", then: "moved", to: { beside: "now", edge: "bottom" } },
      { what: "panel:pr", by: "app", beside: "room", edge: "right", then: "kept" },
    ])
  })

  test("closed and resized placements say so; replaces and closes alone aren't spots", () => {
    const steps = [
      step(0, { target: "room", edge: "right" }),
      step(1000, { act: "close", by: "hand" }),
      step(60_000, { pane: "pane-5", act: "replace", target: "panel:pr" }),
      step(120_000, { pane: "pane-6", target: "room", edge: "bottom" }),
      step(121_000, { act: "resize", by: "hand", pane: "split-9", what: "split" }),
    ]
    expect(pastOf(steps).map((p) => p.then)).toEqual(["closed", "resized"])
  })

  test("a pick is used only when sure, for the layout it was asked about, on a pane that's there", () => {
    keep("c", root, { task: { pane: "main", edge: "bottom", p: 0.9 }, "panel:pr": { pane: "main", edge: "right", p: 0.5 }, activity: { pane: "pane-9", edge: "top", p: 0.95 } })
    expect(smartSpot("c", root, "task")).toEqual({ id: "main", edge: "bottom" })
    expect(smartSpot("c", root, "panel:pr")).toBeNull()
    expect(smartSpot("c", root, "activity")).toBeNull()
    expect(smartSpot("c", { ...root }, "task")).toBeNull()
    expect(smartSpot("d", root, "task")).toBeNull()
  })
})
