import { expect, test } from "bun:test"
import { nextTextSize } from "./theme"

test("the zoom keys step through Settings' text sizes, stop at either end, and ⌘0 goes back to Default", () => {
  expect(nextTextSize("default", "bigger")).toBe("large")
  expect(nextTextSize("large", "bigger")).toBe("larger")
  expect(nextTextSize("larger", "bigger")).toBe("larger")
  expect(nextTextSize("default", "smaller")).toBe("small")
  expect(nextTextSize("small", "smaller")).toBe("small")
  expect(nextTextSize("small", "bigger")).toBe("default")
  expect(nextTextSize("larger", "reset")).toBe("default")
})
