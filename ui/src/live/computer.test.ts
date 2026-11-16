import { describe, expect, mock, test } from "bun:test"

import type { HookRow, KnownHarness } from "@kiwi/core/harnesses.ts"

const calls: string[] = []
let presses = 0
let answer: "normal" | "none" | "no tmux" | "throws" = "normal"
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
  settingsOn: async (machinePk: string) =>
    machinePk === "studio"
      ? {
          ok: true as const,
          value: {
            hooks: [{ harness: "claude" as const, state: "outdated" as const, text: "" }],
            seats: [{ channel: "kiwi", agent: "builder", wake: "on" as const }],
          },
        }
      : { ok: false as const, detail: "laptop didn't answer: it's offline" },
  doctor: async () => [{ ok: false as const, what: "Codex's hooks are from an older kiwi", how: "Update them" }],
  upPlan: async () =>
    presses
      ? [{ channel: "kiwi", handle: "atlas", folder: "/w", result: "running" as const, why: "its session is still running", before: true }]
      : [
          { channel: "kiwi", handle: "atlas", folder: "/w", result: "planned" as const, why: "kiwi up --seat atlas -c kiwi", before: true },
          { channel: "kiwi", handle: "sage", folder: "/w", result: "skipped" as const, why: "kiwi up doesn't restore codex seats yet", skip: "unsupported" as const, before: true },
          { channel: "kiwi", handle: "nova", folder: "/w", result: "skipped" as const, why: "its membership couldn't be checked: offline", skip: "unverified" as const, before: true },
          { channel: "kiwi", handle: "old", folder: "/w", result: "skipped" as const, why: "it wasn't running when this computer went down", skip: "idle" as const, before: false },
          { channel: "kiwi", handle: "win", folder: "/w", result: "running" as const, why: "its session is still running", before: true },
        ],
  bringBack: async () => {
    presses++
    if (answer === "none") return null
    if (answer === "throws") throw new Error("kiwi up exited 1")
    if (answer === "no tmux")
      return [
        { channel: "kiwi", handle: "atlas", folder: "/w", result: "printed" as const, why: "kiwi up --seat atlas -c kiwi" },
        { channel: "kiwi", handle: "nova", folder: "/w", result: "printed" as const, why: "kiwi up --seat nova -c kiwi" },
      ]
    return [
      {
        channel: "kiwi",
        handle: "atlas",
        folder: "/w",
        result: presses === 1 ? ("restored" as const) : ("running" as const),
        why: presses === 1 ? "it resumed its session" : "its session is still running",
      },
      { channel: "kiwi", handle: "sage", folder: "/w", result: "skipped" as const, why: "kiwi up doesn't restore codex seats yet: start it yourself in its folder" },
      { channel: "kiwi", handle: "nova", folder: "/w", result: "failed" as const, why: "Claude Code didn't start a session within 60s" },
    ]
  },
}
let bridged = false
mock.module("@kiwi/secrets/secrets.ts", () => ({ bridge: () => (bridged ? fake : null) }))
const { backPrompt, bringAgentsBack, checkComputer, loadUpPlan, upPlanNow, computerNow, computerSettings, loadComputer, setContextLine, setHooks } = await import("~/live/computer")
const { backCard } = await import("~/shell/back-card")
const { backRow } = await import("~/settings/back-row")
const { acts } = await import("~/settings/sheet")

const toasts: [string, string][] = []
const card = () =>
  backCard(
    { down: [{ channel: "kiwi", handle: "atlas", folder: "/w", result: "planned", why: "kiwi up --seat atlas -c kiwi", before: true }], apart: [] },
    bringAgentsBack,
    (text, tone) => void toasts.push([text, tone])
  )
const settingsRow = () => {
  const run = computerNow()?.run
  if (!run) throw new Error("no computer")
  return backRow(run, acts(), () => {})
}

describe("Settings > Agents shows this computer", () => {
  test("without the desktop bridge (web) there's no computer, so no Bring my agents back, and the call refuses", async () => {
    await loadComputer()
    expect(computerNow()).toBeNull()
    await expect(bringAgentsBack()).rejects.toThrow("this needs the Channels desktop app")
    bridged = true
  })

  test("kiwi's version, and the hooks of every harness that takes them", async () => {
    await loadComputer()
    expect(computerNow()).toEqual({
      kiwi: { running: true, version: "2026.10.8" },
      hooks: [
        { harness: "claude", label: "Claude Code", state: "installed" },
        { harness: "codex", label: "Codex", state: "outdated" },
      ],
      contextLine: false,
      back: null,
      run: { at: "idle" },
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

  test("after a restart, Home's prompt counts the seats from before it that kiwi up would start, and lists unsupported and unverified ones apart", async () => {
    await loadUpPlan()
    const prompt = backPrompt(upPlanNow())
    expect(prompt?.down.map((s) => s.handle)).toEqual(["atlas"])
    expect(prompt?.apart.map((s) => [s.handle, s.skip])).toEqual([
      ["sage", "unsupported"],
      ["nova", "unverified"],
    ])
  })

  test("Bring my agents back hands back each seat's outcome from kiwi up, and a second press finds the seat already running", async () => {
    const first = await bringAgentsBack()
    expect(first.at === "done" && first.outcomes.map((o) => [o.handle, o.result])).toEqual([
      ["atlas", "restored"],
      ["sage", "skipped"],
      ["nova", "failed"],
    ])
    const second = await bringAgentsBack()
    expect(second.at === "done" && second.outcomes[0]).toEqual({ channel: "kiwi", handle: "atlas", folder: "/w", result: "running", why: "its session is still running" })
    expect(presses).toBe(2)
    expect(backPrompt(upPlanNow())).toBeNull()
  })

  test("Check this computer hands back kiwi doctor's findings", async () => {
    expect(await checkComputer()).toEqual([{ ok: false, what: "Codex's hooks are from an older kiwi", how: "Update them" }])
  })

  test("a paired computer's settings read as lines, or say why it didn't answer", async () => {
    expect(await computerSettings("studio")).toEqual([
      ["Hooks", ["Claude Code out of date"]],
      ["Agents", ["builder in kiwi, wakes on a message"]],
    ])
    await expect(computerSettings("laptop")).rejects.toThrow("laptop didn't answer: it's offline")
  })

  test("with kiwi stopped, it says so", async () => {
    running = false
    await loadComputer()
    expect(computerNow()?.kiwi).toEqual({ running: false })
  })
})

describe("the restart card's Bring them back says only what happened, and Settings shows the same run (#11413)", () => {
  test("a partial failure from the card names it, and Settings then shows each seat's reason without a second launch", async () => {
    answer = "normal"
    await card().onAct()
    const before = presses
    expect(toasts.at(-1)).toEqual(["1 back, 2 not: Settings > Agents shows why", "error"])
    const shown = settingsRow()
    expect(shown).toContain("1 back\\, 2 not back")
    expect(shown).toContain("nova · kiwi")
    expect(shown).toContain("start a session within 60s")
    expect(shown).toContain("restore codex seats yet")
    expect(presses).toBe(before)
  })

  test("when kiwi up gives no answer, the card says so, not that the agents are back", async () => {
    answer = "none"
    await card().onAct()
    expect(toasts.at(-1)).toEqual(["kiwi up didn't answer: run it in a terminal to see why", "error"])
    expect(computerNow()?.run).toEqual({ at: "no.answer" })
    expect(settingsRow()).toContain("kiwi up")
  })

  test("when kiwi up fails outright, the card says it didn't answer", async () => {
    answer = "throws"
    await card().onAct()
    expect(toasts.at(-1)).toEqual(["kiwi up didn't answer: run it in a terminal to see why", "error"])
    expect(computerNow()?.run).toEqual({ at: "no.answer" })
  })

  test("without tmux, printed commands count as not back, and Settings lists the lines to run", async () => {
    answer = "no tmux"
    await card().onAct()
    expect(toasts.at(-1)).toEqual(["0 back, 2 not: Settings > Agents shows why", "error"])
    expect(settingsRow()).toContain("`kiwi up --seat nova -c kiwi`")
  })

  test("only when every seat is back or already running does the card say they're back", async () => {
    answer = "normal"
    fake.bringBack = async () => (presses++, [{ channel: "kiwi", handle: "atlas", folder: "/w", result: "restored" as const, why: "it resumed its session" }])
    await card().onAct()
    expect(toasts.at(-1)).toEqual(["Your agents are back", "info"])
    expect(settingsRow()).toContain("1 back\\, 0 not back")
  })
})
