import { describe, expect, test } from "bun:test"

import { eventCombos, keyLabel } from "~/commands/keys"
import { parseKey } from "~/commands/rebind"

const press = (e: Partial<KeyboardEvent>) => eventCombos({ key: "", code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...e })

describe("keys.json keys", () => {
  test("a key is written in any case and order of words, and comes out in one form", () => {
    expect(parseKey("Mod+Shift+K")).toBe("mod+shift+k")
    expect(parseKey("shift+mod+k")).toBe("mod+shift+k")
    expect(parseKey("cmd+[")).toBe("meta+[")
    expect(parseKey("option+up")).toBe("alt+arrowup")
    expect(parseKey("control+esc")).toBe("ctrl+escape")
    expect(parseKey("mod+plus")).toBe("mod++")
    expect(parseKey("mod++")).toBe("mod++")
    expect(parseKey("ctrl+F13")).toBe("ctrl+f13")
    expect(parseKey("mod+\\")).toBe("mod+\\")
  })

  test("what isn't a key is refused", () => {
    expect(parseKey("")).toBeNull()
    expect(parseKey("mod+")).toBeNull()
    expect(parseKey("hyper+k")).toBeNull()
    expect(parseKey("mod+shift+shift+k")).toBeNull()
    expect(parseKey("mod+ctrl+k")).toBeNull()
    expect(parseKey("mod+kk")).toBeNull()
    expect(parseKey("f25")).toBeNull()
  })
})

describe("a key press", () => {
  test("⌘ or Ctrl is mod on every computer, and each also stands for itself", () => {
    expect(press({ metaKey: true, key: "k", code: "KeyK" })).toEqual(["mod+k", "meta+k"])
    expect(press({ ctrlKey: true, key: "k", code: "KeyK" })).toEqual(["mod+k", "ctrl+k"])
    expect(press({ altKey: true, key: "ArrowDown", code: "ArrowDown" })).toEqual(["alt+arrowdown"])
  })

  test("a letter follows the layout: Dvorak's ⌘U is never ⌘F", () => {
    expect(press({ metaKey: true, key: "u", code: "KeyF" })).toEqual(["mod+u", "meta+u"])
  })

  test("on a layout without Latin letters, or with ⌥ on a Mac, the key's place decides", () => {
    expect(press({ metaKey: true, key: "л", code: "KeyK" })).toContain("mod+k")
    expect(press({ altKey: true, key: "∂", code: "KeyD" })).toContain("alt+d")
    expect(press({ metaKey: true, key: "ü", code: "BracketLeft" })).toContain("mod+[")
  })

  test("with Shift, a symbol is also its unshifted key", () => {
    expect(press({ metaKey: true, shiftKey: true, key: "{", code: "BracketLeft" })).toContain("mod+shift+[")
    expect(press({ metaKey: true, shiftKey: true, key: "!", code: "Digit1" })).toContain("mod+shift+1")
  })
})

describe("key labels", () => {
  test("a Mac shows symbols in Apple's order", () => {
    expect(keyLabel("mod+shift+k", true)).toBe("⇧⌘K")
    expect(keyLabel("mod+\\", true)).toBe("⌘\\")
    expect(keyLabel("alt+arrowdown", true)).toBe("⌥↓")
    expect(keyLabel("ctrl+alt+f5", true)).toBe("⌃⌥F5")
  })

  test("Linux spells them out", () => {
    expect(keyLabel("mod+shift+k", false)).toBe("Ctrl+Shift+K")
    expect(keyLabel("meta+k", false)).toBe("Super+K")
    expect(keyLabel("alt+arrowup", false)).toBe("Alt+↑")
  })
})
