import { describe, expect, test } from "bun:test"

import { fromFrame, heeded, LOOK, MOD_PROTOCOL, SIDE_HEIGHT, STORAGE } from "~/mods/protocol"
import { TOKENS } from "~/theme/derive"

describe("a mod frame's messages", () => {
  test("only the protocol's shapes come through, trimmed to what the page uses", () => {
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "hello", extra: 1 })).toEqual({ kiwi: MOD_PROTOCOL, type: "hello" })
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "panel", title: "Linear" })).toEqual({ kiwi: MOD_PROTOCOL, type: "panel", title: "Linear" })
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "commands", list: [{ id: "a", title: "A", run: "x" }] })).toEqual({
      kiwi: MOD_PROTOCOL,
      type: "commands",
      list: [{ id: "a", title: "A" }],
    })
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "fetch", id: 3, url: "https://api.linear.app/x", init: { method: "POST", headers: { a: "b", n: 1 }, body: "{}" } })).toEqual({
      kiwi: MOD_PROTOCOL,
      type: "fetch",
      id: 3,
      url: "https://api.linear.app/x",
      init: { method: "POST", headers: { a: "b" }, body: "{}" },
    })
  })

  test("a sidebar section's title and height, and a mod's message actions, come through", () => {
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "sidebar", title: "Standup" })).toEqual({ kiwi: MOD_PROTOCOL, type: "sidebar", title: "Standup" })
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "size", height: 87.4 })).toEqual({ kiwi: MOD_PROTOCOL, type: "size", height: 87 })
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "actions", list: [{ id: "keep", title: "Keep in notes", run: "x" }] })).toEqual({
      kiwi: MOD_PROTOCOL,
      type: "actions",
      list: [{ id: "keep", title: "Keep in notes" }],
    })
  })

  test("a sidebar section stays between its smallest and tallest height", () => {
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "size", height: 0 })).toEqual({ kiwi: MOD_PROTOCOL, type: "size", height: SIDE_HEIGHT.min })
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "size", height: 1e9 })).toEqual({ kiwi: MOD_PROTOCOL, type: "size", height: SIDE_HEIGHT.max })
  })

  test("anything else is dropped", () => {
    for (const m of [
      null,
      "hello",
      { type: "hello" },
      { kiwi: 2, type: "hello" },
      { kiwi: MOD_PROTOCOL, type: "boot" },
      { kiwi: MOD_PROTOCOL, type: "panel", title: "" },
      { kiwi: MOD_PROTOCOL, type: "panel", title: "x".repeat(81) },
      { kiwi: MOD_PROTOCOL, type: "commands", list: [{ id: "", title: "A" }] },
      { kiwi: MOD_PROTOCOL, type: "commands", list: Array.from({ length: 51 }, (_, i) => ({ id: `c${i}`, title: "C" })) },
      { kiwi: MOD_PROTOCOL, type: "sidebar", title: "" },
      { kiwi: MOD_PROTOCOL, type: "size", height: -1 },
      { kiwi: MOD_PROTOCOL, type: "size", height: Number.NaN },
      { kiwi: MOD_PROTOCOL, type: "size", height: "80" },
      { kiwi: MOD_PROTOCOL, type: "actions", list: [{ id: "a" }] },
      { kiwi: MOD_PROTOCOL, type: "actions", list: Array.from({ length: 11 }, (_, i) => ({ id: `a${i}`, title: "A" })) },
      { kiwi: MOD_PROTOCOL, type: "action", id: "a", message: {} },
      { kiwi: MOD_PROTOCOL, type: "fetch", id: 1.5, url: "https://x" },
      { kiwi: MOD_PROTOCOL, type: "fetch", id: 1, url: "" },
    ])
      expect(fromFrame(m)).toBeNull()
  })

  test("a mod's storage, toasts, links and copies come through only in their shapes and sizes", () => {
    const at = (m: Record<string, unknown>) => fromFrame({ kiwi: MOD_PROTOCOL, ...m })
    expect(at({ type: "storage", id: 1, op: "set", key: "k", value: "1" })).toEqual({ kiwi: MOD_PROTOCOL, type: "storage", id: 1, op: "set", key: "k", value: "1" })
    expect(at({ type: "storage", id: 2, op: "get", key: "k", value: "dropped" })).toEqual({ kiwi: MOD_PROTOCOL, type: "storage", id: 2, op: "get", key: "k", value: null })
    expect(at({ type: "storage", id: 3, op: "keys", key: "ignored" })).toEqual({ kiwi: MOD_PROTOCOL, type: "storage", id: 3, op: "keys", key: null, value: null })
    for (const bad of [
      { id: 1.5, op: "get", key: "k" },
      { id: 1, op: "clear", key: "k" },
      { id: 1, op: "get", key: "" },
      { id: 1, op: "get", key: "k".repeat(STORAGE.key + 1) },
      { id: 1, op: "set", key: "k" },
      { id: 1, op: "set", key: "k", value: "x".repeat(STORAGE.value + 1) },
    ])
      expect(at({ type: "storage", ...bad })).toBeNull()
    expect(at({ type: "toast", title: "Saved", message: "", style: "loud" })).toEqual({ kiwi: MOD_PROTOCOL, type: "toast", title: "Saved", message: null, style: null })
    expect(at({ type: "toast", title: "x".repeat(201) })).toBeNull()
    expect(at({ type: "open", url: "https://linear.app/x" })).toEqual({ kiwi: MOD_PROTOCOL, type: "open", url: "https://linear.app/x" })
    for (const url of ["javascript:alert(1)", "file:///etc/hosts", "kiwi://join/x", `https://x/${"a".repeat(2_000)}`]) expect(at({ type: "open", url })).toBeNull()
    expect(at({ type: "copy", text: "KIW-12" })).toEqual({ kiwi: MOD_PROTOCOL, type: "copy", text: "KIW-12" })
    expect(at({ type: "copy", text: "x".repeat(100_001) })).toBeNull()
  })

  test("an error always has some words, and never a whole page of them", () => {
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "error" })).toEqual({ kiwi: MOD_PROTOCOL, type: "error", message: "it threw with no message" })
    expect((fromFrame({ kiwi: MOD_PROTOCOL, type: "error", message: "x".repeat(5_000) }) as { message: string }).message).toHaveLength(2_000)
  })
})

describe("what a mod's frame may do", () => {
  const mod = (needs: string[], state = "on") => ({ state, needs })

  test("a panel, commands, a sidebar section and message actions each need the capability the person approved", () => {
    expect(heeded("panel", "main", mod(["panel"]))).toBe(true)
    expect(heeded("commands", "main", mod(["command"]))).toBe(true)
    expect(heeded("actions", "main", mod(["message-action"]))).toBe(true)
    expect(heeded("sidebar", "sidebar", mod(["sidebar"]))).toBe(true)
    expect(heeded("size", "sidebar", mod(["sidebar"]))).toBe(true)
    for (const type of ["panel", "commands", "actions"] as const) expect(heeded(type, "main", mod(["net:example.com"]))).toBe(false)
    expect(heeded("sidebar", "sidebar", mod(["panel"]))).toBe(false)
  })

  test("only the sidebar's own frame shows the section, and only the main frame adds commands and actions", () => {
    expect(heeded("sidebar", "main", mod(["sidebar"]))).toBe(false)
    expect(heeded("size", "main", mod(["sidebar"]))).toBe(false)
    expect(heeded("commands", "sidebar", mod(["command"]))).toBe(false)
    expect(heeded("actions", "sidebar", mod(["message-action"]))).toBe(false)
    expect(heeded("panel", "sidebar", mod(["panel"]))).toBe(false)
  })

  test("a mod that isn't on, or is gone, gets nothing", () => {
    expect(heeded("panel", "main", mod(["panel"], "asks"))).toBe(false)
    expect(heeded("actions", "main", undefined)).toBe(false)
  })

  test("storage, toasts, links and copies need no capability, only a mod that is on", () => {
    for (const type of ["storage", "toast", "open", "copy"] as const) {
      expect(heeded(type, "sidebar", mod([]))).toBe(true)
      expect(heeded(type, "main", mod(["panel"], "asks"))).toBe(false)
      expect(heeded(type, "main", undefined)).toBe(false)
    }
  })

  test("what needs no capability always comes through", () => {
    for (const type of ["hello", "ready", "error", "fetch"] as const) expect(heeded(type, "sidebar", mod([]))).toBe(true)
  })
})

test("a mod's frame gets every color of the person's theme", () => {
  expect(LOOK).toEqual([...TOKENS])
})
