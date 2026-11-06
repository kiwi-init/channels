import { describe, expect, test } from "bun:test"

import { fromFrame, LOOK, MOD_PROTOCOL } from "~/mods/protocol"
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
      { kiwi: MOD_PROTOCOL, type: "fetch", id: 1.5, url: "https://x" },
      { kiwi: MOD_PROTOCOL, type: "fetch", id: 1, url: "" },
    ])
      expect(fromFrame(m)).toBeNull()
  })

  test("an error always has some words, and never a whole page of them", () => {
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "error" })).toEqual({ kiwi: MOD_PROTOCOL, type: "error", message: "it threw with no message" })
    expect((fromFrame({ kiwi: MOD_PROTOCOL, type: "error", message: "x".repeat(5_000) }) as { message: string }).message).toHaveLength(2_000)
  })
})

test("a mod's frame gets every color of the person's theme", () => {
  expect(LOOK).toEqual([...TOKENS])
})
