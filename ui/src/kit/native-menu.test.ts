import { describe, expect, test } from "bun:test"
import { nativeMenuAllowed } from "~/kit/native-menu"

const el = (inField: boolean) => ({ closest: (selector: string) => (inField && selector.includes("textarea") ? {} : null) })

describe("the browser's own right-click menu (#1002)", () => {
  test("stays off on the app's surface", () => {
    expect(nativeMenuAllowed(el(false), "")).toBe(false)
    expect(nativeMenuAllowed(null, "")).toBe(false)
    expect(nativeMenuAllowed(el(false), "   ")).toBe(false)
  })

  test("still opens in a text field or on selected text, for copy and paste", () => {
    expect(nativeMenuAllowed(el(true), "")).toBe(true)
    expect(nativeMenuAllowed(el(false), "some words")).toBe(true)
  })
})
