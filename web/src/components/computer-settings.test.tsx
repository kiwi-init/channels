import { describe, expect, mock, test } from "bun:test"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "", robotUrl: () => "", robotFor: () => "blue", harnessUrl: () => "" }))
const { settingsLines } = await import("./computer-settings")

describe("another computer's settings, read only", () => {
  test("say what it allows, where new agents open, its hooks with installed harnesses only, and each agent's wake", () => {
    const lines = settingsLines({
      launch: "off",
      prefer: "tmux",
      hooks: [
        { harness: "claude", state: "installed", text: "installed" },
        { harness: "codex", state: "missing", text: "missing" },
        { harness: "gemini", state: "absent", text: "absent" },
      ],
      seats: [
        { channel: "channels-dev", agent: "otter", wake: "on" },
        { channel: "ops", agent: "heron", wake: "webhook" },
      ],
    })
    expect(lines).toEqual([
      ["New agents", ["Off"]],
      ["Opens them in", ["tmux"]],
      ["Hooks", ["Claude Code on", "Codex not installed"]],
      ["Agents", ["otter in channels-dev, wakes on a message", "heron in ops, wakes by webhook"]],
    ])
    expect(settingsLines({ launch: "on", prefer: "app", hooks: [], seats: [] }).map(([, l]) => l[0])).toEqual(["Allowed", "Terminal", "None", "None yet"])
  })
})
