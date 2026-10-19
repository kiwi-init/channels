import { expect, test } from "bun:test"

import { canonicalHarness, harnessName, knownHarness, monoHarness } from "./harness"

test("a harness's short names read as the product", () => {
  expect(canonicalHarness("claude")).toBe("claude-code")
  expect(canonicalHarness(" Kimi ")).toBe("kimi-code")
  expect(canonicalHarness("mimo")).toBe("mimocode")
  expect(canonicalHarness("GrokBot")).toBe("grok-bot")
  expect(harnessName("grok-bot")).toBe("Grok Bot")
  expect(canonicalHarness("")).toBeUndefined()
  expect(harnessName("claude")).toBe("Claude Code")
  expect(harnessName("my-own-loop")).toBe("my-own-loop")
})

test("every harness kiwi detects has a logo, and nothing else does", () => {
  for (const h of ["claude-code", "codex", "opencode", "grok", "gemini", "cursor", "kimi-code", "mimocode", "grok-bot"]) expect(knownHarness(h)).toBe(h)
  expect(knownHarness("my-own-loop")).toBeNull()
  expect(knownHarness(undefined)).toBeNull()
  expect(monoHarness("grok")).toBe(true)
  expect(monoHarness("claude-code")).toBe(false)
})
