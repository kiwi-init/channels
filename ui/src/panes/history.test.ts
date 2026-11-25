import { describe, expect, test } from "bun:test"

import { fixes, remember, type Step } from "~/panes/history"

const step = (at: number, more: Partial<Step>): Step => ({ at, code: "c", act: "open", by: "app", pane: "pane-2", what: "task", screen: { w: 1200, h: 800 }, panes: [], ...more })

describe("tiling history", () => {
  test("a drag on one divider keeps one resize step", () => {
    let steps: Step[] = []
    for (const at of [0, 200, 400, 600]) steps = remember(steps, step(at, { act: "resize", by: "hand", pane: "split-1", what: "split" }))
    expect(steps).toHaveLength(1)
    expect(steps[0]?.at).toBe(600)
  })

  test("a resize after a pause is a new step", () => {
    const one = remember([], step(0, { act: "resize", by: "hand", pane: "split-1" }))
    expect(remember(one, step(5000, { act: "resize", by: "hand", pane: "split-1" }))).toHaveLength(2)
  })

  test("the history keeps the last 400 steps", () => {
    let steps: Step[] = []
    for (let i = 0; i < 450; i++) steps = remember(steps, step(i * 2000, { pane: `pane-${i}` }))
    expect(steps).toHaveLength(400)
    expect(steps[0]?.pane).toBe("pane-50")
  })

  test("moving a pane the app just placed is a fix", () => {
    const placed = step(0, {})
    const moved = step(4000, { act: "move", by: "hand", edge: "bottom" })
    expect(fixes([placed, moved])).toEqual([{ placed, fixed: moved }])
  })

  test("a resize right after the app placed a pane is a fix", () => {
    const placed = step(0, {})
    const resized = step(2000, { act: "resize", by: "hand", pane: "split-3", what: "split" })
    expect(fixes([placed, resized])).toEqual([{ placed, fixed: resized }])
  })

  test("a pane kept past 15 seconds, or placed by hand, is not a fix", () => {
    expect(fixes([step(0, {}), step(20_000, { act: "close", by: "hand" })])).toEqual([])
    expect(fixes([step(0, { by: "hand" }), step(1000, { act: "close", by: "hand" })])).toEqual([])
  })

  test("a later app placement takes the fix that follows it", () => {
    const first = step(0, {})
    const second = step(1000, { pane: "pane-3" })
    const closed = step(2000, { act: "close", by: "hand", pane: "pane-3" })
    expect(fixes([first, second, closed])).toEqual([{ placed: second, fixed: closed }])
  })

  test("other channels don't count", () => {
    expect(fixes([step(0, {}), step(1000, { act: "close", by: "hand", code: "d" })])).toEqual([])
  })
})
