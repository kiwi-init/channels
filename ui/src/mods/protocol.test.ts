import { describe, expect, test } from "bun:test"

import { fromFrame, heeded, LOOK, MOD_PROTOCOL, sameTarget, SIDE_HEIGHT, STORAGE, target } from "~/mods/protocol"
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

  test("a mod's storage and toasts come through only in their shapes and sizes", () => {
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

describe("a tab, and showing a pull request or issue", () => {
  test("a tab's title, whether it shows, and its alert and hint come through", () => {
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "tab", title: "GitHub", alert: "An open pull request's checks failed", hint: "3 open pull requests" })).toEqual({
      kiwi: MOD_PROTOCOL,
      type: "tab",
      title: "GitHub",
      shown: true,
      alert: "An open pull request's checks failed",
      hint: "3 open pull requests",
    })
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "tab", title: "GitHub", shown: false, alert: 4 })).toEqual({ kiwi: MOD_PROTOCOL, type: "tab", title: "GitHub", shown: false, alert: null, hint: null })
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "tab", title: "x".repeat(41) })).toBeNull()
  })

  test("a target names a repo and a number, or a view, and nothing else", () => {
    expect(target({ kind: "pr", repo: "kiwi-init/channels", number: 45, extra: 1 })).toEqual({ kind: "pr", repo: "kiwi-init/channels", number: 45 })
    expect(target({ kind: "issue", repo: "a.b/c-d", number: 1 })).toEqual({ kind: "issue", repo: "a.b/c-d", number: 1 })
    expect(target({ kind: "view", view: "issues" })).toEqual({ kind: "view", view: "issues" })
    for (const bad of [
      { kind: "pr", repo: "../../etc", number: 1 },
      { kind: "pr", repo: "a/b/c", number: 1 },
      { kind: "pr", repo: "a/b", number: 0 },
      { kind: "pr", repo: "a/b", number: 1.5 },
      { kind: "commit", repo: "a/b", number: 1 },
      { kind: "view", view: "" },
      null,
      "pr",
    ])
      expect(target(bad)).toBeNull()
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "show", target: { kind: "pr", repo: "a/b", number: -1 } })).toBeNull()
  })

  test("a mod opens a task, the channel's settings or the chat, and nothing else", () => {
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "open", to: { kind: "task", id: 12 } })).toEqual({ kiwi: MOD_PROTOCOL, type: "open", to: { kind: "task", id: 12 } })
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "open", to: { kind: "settings", tab: "danger" } })).toEqual({ kiwi: MOD_PROTOCOL, type: "open", to: { kind: "settings" } })
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "open", to: { kind: "task", id: "12" } })).toBeNull()
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "open", to: { kind: "url", url: "https://x" } })).toBeNull()
  })

  test("a frame copies text with a short note, and opens web links only", () => {
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "copy", text: "Channels6270-github-mod", note: "Branch name copied" })).toEqual({
      kiwi: MOD_PROTOCOL,
      type: "copy",
      text: "Channels6270-github-mod",
      note: "Branch name copied",
    })
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "copy", text: "x", note: "n".repeat(81) })).toEqual({ kiwi: MOD_PROTOCOL, type: "copy", text: "x", note: null })
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "copy", text: "x".repeat(10_001) })).toBeNull()
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "link", url: "https://github.com/kiwi-init/channels/pull/45" })).toEqual({
      kiwi: MOD_PROTOCOL,
      type: "link",
      url: "https://github.com/kiwi-init/channels/pull/45",
    })
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "views://internal/index.html", "kiwi://x", "not a url", ""]) expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "link", url })).toBeNull()
  })

  test("two targets are the same when they name the same thing", () => {
    expect(sameTarget({ kind: "pr", repo: "a/b", number: 1 }, { kind: "pr", repo: "a/b", number: 1 })).toBe(true)
    expect(sameTarget({ kind: "pr", repo: "a/b", number: 1 }, { kind: "issue", repo: "a/b", number: 1 })).toBe(false)
    expect(sameTarget(null, null)).toBe(true)
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

  test("only the tab's own frame names the tab, opening needs github and showing needs a panel, from any frame", () => {
    expect(heeded("tab", "tab", mod(["tab"]))).toBe(true)
    expect(heeded("tab", "main", mod(["tab"]))).toBe(false)
    expect(heeded("tab", "tab", mod(["panel"]))).toBe(false)
    for (const from of ["main", "sidebar", "tab"] as const) {
      expect(heeded("open", from, mod(["github"]))).toBe(true)
      expect(heeded("show", from, mod(["panel"]))).toBe(true)
    }
    expect(heeded("open", "tab", mod(["tab", "panel"]))).toBe(false)
    expect(heeded("show", "tab", mod(["tab", "github"]))).toBe(false)
  })

  test("a mod that isn't on, or is gone, gets nothing", () => {
    expect(heeded("panel", "main", mod(["panel"], "asks"))).toBe(false)
    expect(heeded("actions", "main", undefined)).toBe(false)
  })

  test("storage, toasts, links and copies need no capability, only a mod that is on", () => {
    for (const type of ["storage", "toast", "copy", "link"] as const) {
      expect(heeded(type, "sidebar", mod([]))).toBe(true)
      expect(heeded(type, "main", mod(["panel"], "asks"))).toBe(false)
      expect(heeded(type, "main", undefined)).toBe(false)
    }
  })

  test("what needs no capability always comes through", () => {
    for (const type of ["hello", "ready", "error", "fetch", "copy", "link"] as const) expect(heeded(type, "sidebar", mod([]))).toBe(true)
  })

  test("an idle frame can only say what it draws, open a channel with channels, and leave: no links, copies, toasts, storage, fetches or panels (T8257)", () => {
    const calm = mod(["idle", "channels", "panel", "github", "command", "net:example.com"])
    for (const type of ["hello", "ready", "error", "idle", "leave", "channel"] as const) expect(heeded(type, "idle", calm)).toBe(true)
    for (const type of ["link", "copy", "toast", "storage", "fetch", "open", "show", "panel", "commands", "tab", "terminal"] as const) expect(heeded(type, "idle", calm)).toBe(false)
  })

  test("idle and leave need idle, from the idle frame only, and opening a channel needs channels (T8257)", () => {
    expect(heeded("idle", "idle", mod(["channels"]))).toBe(false)
    expect(heeded("idle", "main", mod(["idle"]))).toBe(false)
    expect(heeded("leave", "main", mod(["idle"]))).toBe(false)
    expect(heeded("leave", "idle", mod(["idle"], "asks"))).toBe(false)
    expect(heeded("channel", "main", mod(["channels"]))).toBe(true)
    expect(heeded("channel", "main", mod(["github", "idle"]))).toBe(false)
    expect(heeded("channel", "idle", mod(["idle"]))).toBe(false)
  })
})

describe("the idle and channels messages (T8257)", () => {
  test("an idle frame asks for a wait of 0 to 120 whole minutes, and only the meadow as its backdrop", () => {
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "idle", after: 3, backdrop: "meadow" })).toEqual({ kiwi: MOD_PROTOCOL, type: "idle", after: 3, backdrop: "meadow" })
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "idle", after: 0, backdrop: "https://example.com/x.png" })).toEqual({ kiwi: MOD_PROTOCOL, type: "idle", after: 0, backdrop: null })
    for (const after of [-1, 1.5, 121, "3", null]) expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "idle", after, backdrop: null })).toBeNull()
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "leave", extra: 1 })).toEqual({ kiwi: MOD_PROTOCOL, type: "leave" })
  })

  test("a channel to open is a short code and nothing else", () => {
    expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "channel", code: "cold" })).toEqual({ kiwi: MOD_PROTOCOL, type: "channel", code: "cold" })
    for (const code of ["", "x".repeat(65), 7, null]) expect(fromFrame({ kiwi: MOD_PROTOCOL, type: "channel", code })).toBeNull()
  })
})

test("a mod's frame gets every color of the person's theme", () => {
  expect(LOOK).toEqual([...TOKENS])
})
