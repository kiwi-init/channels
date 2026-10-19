import { expect, test } from "bun:test"

import { labelOf, STATE_LABEL, stateWord } from "./task-labels"

test("one name per task state, the same on the board, the cards and the details", () => {
  expect(STATE_LABEL).toEqual({ todo: "Up next", doing: "In progress", review: "In review", done: "Done" })
  expect(labelOf({ state: "todo", cancelled: false })).toBe("Up next")
  expect(labelOf({ state: "done", cancelled: true })).toBe("Done (cancelled)")
  expect(stateWord({ state: "review", cancelled: false })).toBe("in review")
  expect(stateWord({ state: "done", cancelled: true })).toBe("cancelled")
})
