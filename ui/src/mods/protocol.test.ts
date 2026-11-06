import { describe, expect, test } from "bun:test"

import { fromFrame, heeded, LOOK, MOD_PROTOCOL, SIDE_HEIGHT } from "~/mods/protocol"
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

  test("a terminal call is listing, focusing or marking a seat by its id, and nothing else", () => {
    const seat = "0123456789abcdef"
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "terminal", id: 1, op: "list", seat: "x" })).toEqual({ kiwi: MOD_PROTOCOL, type: "terminal", id: 1, op: "list" })
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "terminal", id: 2, op: "focus", seat })).toEqual({ kiwi: MOD_PROTOCOL, type: "terminal", id: 2, op: "focus", seat })
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "terminal", id: 3, op: "mark", seat, mark: { asks: 2, tasks: [7], text: "#(rm -rf ~)" } })).toEqual({
      kiwi: MOD_PROTOCOL,
      type: "terminal",
      id: 3,
      op: "mark",
      seat,
      mark: { asks: 2, tasks: [7] },
    })
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "terminal", id: 4, op: "mark", seat, mark: null })).toEqual({ kiwi: MOD_PROTOCOL, type: "terminal", id: 4, op: "mark", seat, mark: null })
    const room = "b6d383226365dd0ba576eff3d66f71a0"
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "terminal", id: 5, op: "focus", room, agent: "radiant-otter", pane: "%1" })).toEqual({
      kiwi: MOD_PROTOCOL,
      type: "terminal",
      id: 5,
      op: "focus",
      room,
      agent: "radiant-otter",
    })
    for (const m of [
      { op: "run", seat, command: "rm -rf ~" },
      { op: "keys", seat, keys: "rm -rf ~ Enter" },
      { op: "type", seat, text: "yes\n" },
      { op: "read", seat },
      { op: "screen", seat },
      { op: "write", seat, path: "~/.zshrc", text: "x" },
      { op: "install", seat, path: "/etc/hosts" },
      { op: "focus", seat: "%1; tmux kill-server" },
      { op: "focus", seat: "../../.ssh" },
      { op: "focus" },
      { op: "focus", room: "general", agent: "ana" },
      { op: "focus", room: "b6d383226365dd0ba576eff3d66f71a0", agent: "../ana" },
      { op: "focus", room: "b6d383226365dd0ba576eff3d66f71a0", agent: "ana; tmux kill-server" },
      { op: "focus", room: "b6d383226365dd0ba576eff3d66f71a0" },
      { op: "mark", seat, mark: { asks: -1 } },
      { op: "mark", seat, mark: { asks: "2" } },
      { op: "mark", seat, mark: { tasks: ["T7"] } },
      { op: "mark", seat, mark: { tasks: Array.from({ length: 21 }, (_, i) => i + 1) } },
    ])
      expect([m.op, fromFrame({ kiwi: MOD_PROTOCOL, type: "terminal", id: 9, ...m })]).toEqual([m.op, null])
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

  test("terminals need the approved terminal capability, from the main frame", () => {
    expect(heeded("terminal", "main", mod(["terminal"]))).toBe(true)
    expect(heeded("terminal", "main", mod(["panel", "command", "message-action"]))).toBe(false)
    expect(heeded("terminal", "sidebar", mod(["terminal", "sidebar"]))).toBe(false)
    expect(heeded("terminal", "main", mod(["terminal"], "asks"))).toBe(false)
  })

  test("a mod that isn't on, or is gone, gets nothing", () => {
    expect(heeded("panel", "main", mod(["panel"], "asks"))).toBe(false)
    expect(heeded("actions", "main", undefined)).toBe(false)
  })

  test("what needs no capability always comes through", () => {
    for (const type of ["hello", "ready", "error", "fetch"] as const) expect(heeded(type, "sidebar", mod([]))).toBe(true)
  })
})

test("a mod's frame gets every color of the person's theme", () => {
  expect(LOOK).toEqual([...TOKENS])
})
