import { afterEach, describe, expect, test } from "bun:test"

import type { HarnessOptions } from "@kiwi/core/launch-options.ts"
import { choicesProblem, choicesWords, fitChoices, rememberChoices, rememberedChoices } from "./launch-choices"

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage

afterEach(() => store.clear())

const claude: HarnessOptions = { model: true, effort: ["low", "medium", "high", "xhigh", "max"], permission: ["default", "accept-edits", "plan", "bypass"], context: [1_000_000] }
const remoteClaude: HarnessOptions = { ...claude, permission: ["default", "accept-edits", "plan"] }
const codex: HarnessOptions = {
  model: true,
  effort: ["minimal", "low", "medium", "high", "xhigh"],
  permission: ["default", "accept-edits", "plan", "bypass"],
  context: [128_000, 272_000, 400_000, 1_000_000],
}

describe("the choices a launch remembers", () => {
  test("come back for the same harness on the same computer, else from its last launch anywhere", () => {
    rememberChoices("here", "claude", { model: "opus", effort: "high", permission: "plan", context: 1_000_000 })
    rememberChoices("build", "claude", { model: "sonnet" })
    expect(rememberedChoices("here", "claude", claude)).toEqual({ model: "opus", effort: "high", permission: "plan", context: 1_000_000 })
    expect(rememberedChoices("build", "claude", claude)).toEqual({ model: "sonnet" })
    expect(rememberedChoices("mini", "claude", claude)).toEqual({ model: "sonnet" })
    expect(rememberedChoices("here", "codex", codex)).toEqual({})
  })

  test("drop what the computer's harness doesn't take, like bypass on a paired computer or Claude's efforts on Codex", () => {
    rememberChoices("here", "claude", { effort: "max", permission: "bypass" })
    expect(rememberedChoices("build", "claude", remoteClaude)).toEqual({ effort: "max" })
    expect(fitChoices({ effort: "max", context: 1_000_000, permission: "bypass" }, codex)).toEqual({ context: 1_000_000, permission: "bypass" })
    expect(fitChoices({ model: "opus --yolo", effort: 3, permission: "yolo", context: "1m" }, claude)).toEqual({})
  })

  test("survive storage that holds something else", () => {
    store.set("kiwi.launch-choices", "[1,2]")
    expect(rememberedChoices("here", "claude", claude)).toEqual({})
    store.set("kiwi.launch-choices", "{not json")
    expect(rememberedChoices("here", "claude", claude)).toEqual({})
  })
})

describe("the Options step", () => {
  test("holds Start for a model that isn't one, or Claude's 1M context without a model that takes it", () => {
    expect(choicesProblem("claude", { model: "opus", context: 1_000_000 })).toBeNull()
    expect(choicesProblem("claude", { model: "claude-sonnet-5-5", context: 1_000_000 })).toBeNull()
    expect(choicesProblem("claude", { context: 1_000_000 })).toContain("1M context needs")
    expect(choicesProblem("claude", { model: "haiku", context: 1_000_000 })).toContain("1M context needs")
    expect(choicesProblem("claude", { model: "opus 4" })).toContain("no spaces")
    expect(choicesProblem("codex", { context: 1_000_000 })).toBeNull()
  })

  test("sums up what was picked in a few words, leaving out the defaults", () => {
    expect(choicesWords({ model: "opus", effort: "xhigh", permission: "bypass", context: 1_000_000 })).toEqual(["opus", "extra high", "bypass", "1M"])
    expect(choicesWords({ permission: "default", context: 272_000 })).toEqual(["272K"])
    expect(choicesWords({ effort: "off" })).toEqual(["off"])
    expect(choicesWords({})).toEqual([])
  })
})
