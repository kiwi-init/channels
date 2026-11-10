import { describe, expect, test } from "bun:test"
import { keysHint, mod, onMac } from "~/kit/keys"

const key = (metaKey: boolean, ctrlKey: boolean) => ({ metaKey, ctrlKey })

describe("a shortcut's modifier is ⌘ on a Mac and Ctrl elsewhere, never both (T1852)", () => {
  test("on a Mac, Ctrl+K and Ctrl+F stay what text fields make of them", () => {
    expect(mod(key(true, false), true)).toBe(true)
    expect(mod(key(false, true), true)).toBe(false)
    expect(mod(key(true, true), true)).toBe(false)
  })

  test("on Linux and Windows it is Ctrl, and the Super key alone does nothing", () => {
    expect(mod(key(false, true), false)).toBe(true)
    expect(mod(key(true, false), false)).toBe(false)
    expect(mod(key(false, false), false)).toBe(false)
  })

  test("the platform is read from what the engine says it runs on", () => {
    expect(onMac("MacIntel")).toBe(true)
    expect(onMac("Linux x86_64")).toBe(false)
    expect(onMac("Win32")).toBe(false)
    expect(onMac("")).toBe(false)
  })
})

describe("a shortcut hint names the modifier of the platform it is shown on (T1853)", () => {
  test("a Mac reads its own symbols, exactly as before", () => {
    expect(keysHint("F", false, true)).toBe("⌘F")
    expect(keysHint("S", true, true)).toBe("⇧⌘S")
    expect(keysHint("\\", false, true)).toBe("⌘\\")
    expect(keysHint("↩", false, true)).toBe("⌘↩")
    expect(keysHint("Enter", false, true)).toBe("⌘ Enter")
  })

  test("Linux and Windows read Ctrl, with words for Shift and Enter", () => {
    expect(keysHint("F", false, false)).toBe("Ctrl+F")
    expect(keysHint("S", true, false)).toBe("Ctrl+Shift+S")
    expect(keysHint("\\", false, false)).toBe("Ctrl+\\")
    expect(keysHint("↩", false, false)).toBe("Ctrl+Enter")
    expect(keysHint("Enter", false, false)).toBe("Ctrl+Enter")
  })
})
