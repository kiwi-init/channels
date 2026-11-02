import { describe, expect, test } from "bun:test"

import { byDigit, isSheetKey, railDigit } from "~/shell/shortcut-keys"

const key = (init: Partial<Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">>): KeyboardEvent =>
  ({ key: "", code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init }) as KeyboardEvent

describe("⌘1-9 picks a channel in the rail (T994)", () => {
  test("⌘ or Ctrl with a digit is that digit, from the key or the physical key", () => {
    expect(railDigit(key({ metaKey: true, key: "1", code: "Digit1" }))).toBe(1)
    expect(railDigit(key({ ctrlKey: true, key: "&", code: "Digit7" }))).toBe(7)
    expect(railDigit(key({ metaKey: true, key: "4" }))).toBe(4)
  })

  test("no modifier, Alt, Shift or 0 is no channel", () => {
    expect(railDigit(key({ key: "1", code: "Digit1" }))).toBeNull()
    expect(railDigit(key({ metaKey: true, altKey: true, key: "1", code: "Digit1" }))).toBeNull()
    expect(railDigit(key({ metaKey: true, shiftKey: true, key: "!", code: "Digit1" }))).toBeNull()
    expect(railDigit(key({ metaKey: true, key: "0", code: "Digit0" }))).toBeNull()
  })

  test("1 to 8 count from the top and 9 is always the last", () => {
    const rail = ["a", "b", "c"]
    expect(byDigit(rail, 1)).toBe("a")
    expect(byDigit(rail, 3)).toBe("c")
    expect(byDigit(rail, 4)).toBeNull()
    expect(byDigit(rail, 9)).toBe("c")
    expect(byDigit([], 9)).toBeNull()
  })
})

describe("⌘/ opens the shortcut sheet (T994)", () => {
  test("⌘/ and Ctrl+/, also where / needs Shift", () => {
    expect(isSheetKey(key({ metaKey: true, key: "/", code: "Slash" }))).toBe(true)
    expect(isSheetKey(key({ ctrlKey: true, key: "/", code: "Digit7", shiftKey: true }))).toBe(true)
    expect(isSheetKey(key({ metaKey: true, key: "?", code: "Slash", shiftKey: true }))).toBe(true)
  })

  test("a plain / is typing", () => {
    expect(isSheetKey(key({ key: "/", code: "Slash" }))).toBe(false)
    expect(isSheetKey(key({ metaKey: true, altKey: true, key: "/", code: "Slash" }))).toBe(false)
  })
})
