import { describe, expect, mock, test } from "bun:test"

import type { HookRow, KnownHarness } from "@kiwi/core/harnesses.ts"

const calls: string[] = []
let running = true
let line: "on" | "off" = "off"
let hooks: HookRow[] = [
  { harness: "claude", state: "installed", text: "" },
  { harness: "codex", state: "outdated", text: "" },
  { harness: "gemini", state: "absent", text: "" },
]

const fake = {
  daemonStatus: async () => (running ? { running, version: "2026.10.8" } : { running }),
  hooks: async () => hooks,
  setHooks: async (harness: KnownHarness, to: "on" | "off") => {
    calls.push(`${harness} ${to}`)
    hooks = hooks.map((h) => (h.harness === harness ? { ...h, state: to === "on" ? "installed" : "off" } : h))
    return hooks
  },
  contextLine: async () => line,
  setContextLine: async (to: "on" | "off") => (calls.push(`context line ${to}`), (line = to)),
  doctor: async () => [{ ok: false as const, what: "Codex's hooks are from an older kiwi", how: "Update them" }],
}
mock.module("@/lib/secrets", () => ({ bridge: () => fake }))
const { checkComputer, computerNow, loadComputer, setContextLine, setHooks } = await import("~/live/computer")

describe("Settings > Agents shows this computer", () => {
  test("kiwi's version, and the hooks of every harness that takes them", async () => {
    await loadComputer()
    expect(computerNow()).toEqual({
      kiwi: { running: true, version: "2026.10.8" },
      hooks: [
        { harness: "claude", label: "Claude Code", state: "installed" },
        { harness: "codex", label: "Codex", state: "outdated" },
      ],
      contextLine: false,
    })
  })

  test("Update installs a harness's hooks and Remove takes them out", async () => {
    await setHooks("codex", true)
    await setHooks("claude", false)
    expect(calls).toEqual(["codex on", "claude off"])
    expect(computerNow()?.hooks.map((h) => h.state)).toEqual(["off", "installed"])
  })

  test("the 250k checkpoint ask stays off until it's turned on", async () => {
    await setContextLine(true)
    expect(calls.at(-1)).toBe("context line on")
    expect(computerNow()?.contextLine).toBe(true)
  })

  test("Check this computer hands back kiwi doctor's findings", async () => {
    expect(await checkComputer()).toEqual([{ ok: false, what: "Codex's hooks are from an older kiwi", how: "Update them" }])
  })

  test("with kiwi stopped, it says so", async () => {
    running = false
    await loadComputer()
    expect(computerNow()?.kiwi).toEqual({ running: false })
  })
})
