import { describe, expect, test } from "bun:test"

import { menuKey } from "~/chat/doc/suggest"

const key = (k: string, mod: "meta" | "ctrl" | null = null) => ({ key: k, metaKey: mod === "meta", ctrlKey: mod === "ctrl" })

describe("an open suggestion menu never takes ⌘/Ctrl+Enter (T2565)", () => {
  test("⌘/Ctrl+Enter passes through to the doc's keys, so it always sends or runs", () => {
    expect(menuKey(key("Enter", "meta"))).toBeNull()
    expect(menuKey(key("Enter", "ctrl"))).toBeNull()
  })

  test("plain Enter and Tab pick the suggestion, the arrows move, Escape closes", () => {
    expect(menuKey(key("Enter"))).toBe("choose")
    expect(menuKey(key("Tab"))).toBe("choose")
    expect(menuKey(key("ArrowDown"))).toBe("move")
    expect(menuKey(key("ArrowUp"))).toBe("move")
    expect(menuKey(key("Escape"))).toBe("close")
    expect(menuKey(key("a"))).toBeNull()
  })
})
