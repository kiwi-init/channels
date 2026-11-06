import { describe, expect, test } from "bun:test"

import { keysLabel, pressed, shortcut } from "~/mods/frame/keys"

const press = (code: string, keys: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...keys,
})

describe("a mod's action shortcuts", () => {
  test("a shortcut names its modifiers and one key, in any case and spacing", () => {
    expect(shortcut("mod+shift+e")).toEqual({ mod: true, ctrl: false, alt: false, shift: true, code: "KeyE", key: "e" })
    expect(shortcut(" Cmd + Opt + 4 ")).toEqual({ mod: true, ctrl: false, alt: true, shift: false, code: "Digit4", key: "4" })
    expect(shortcut("ctrl+enter")?.code).toBe("Enter")
    expect(shortcut("alt+,")?.code).toBe("Comma")
  })

  test("a key on its own, a shift-only key, an unknown key or modifier isn't a shortcut", () => {
    for (const text of ["e", "shift+e", "mod+", "mod+f13", "hyper+e", "mod+e+f", ""]) expect(shortcut(text)).toBeNull()
  })

  test("mod is ⌘ on a Mac and Ctrl elsewhere, matched by the key's place so other layouts work", () => {
    const s = shortcut("mod+shift+e")!
    expect(pressed(press("KeyE", { metaKey: true, shiftKey: true }), s, true)).toBe(true)
    expect(pressed(press("KeyE", { ctrlKey: true, shiftKey: true }), s, true)).toBe(false)
    expect(pressed(press("KeyE", { ctrlKey: true, shiftKey: true }), s, false)).toBe(true)
    expect(pressed(press("KeyE", { metaKey: true }), s, true)).toBe(false)
    expect(pressed(press("KeyR", { metaKey: true, shiftKey: true }), s, true)).toBe(false)
  })

  test("the label reads like the app's own: symbols on a Mac, words elsewhere", () => {
    expect(keysLabel(shortcut("mod+shift+e")!, true)).toBe("⇧⌘E")
    expect(keysLabel(shortcut("ctrl+alt+enter")!, true)).toBe("⌃⌥↵")
    expect(keysLabel(shortcut("mod+shift+e")!, false)).toBe("Ctrl+Shift+E")
    expect(keysLabel(shortcut("alt+backspace")!, false)).toBe("Alt+⌫")
  })
})
