import { describe, expect, test } from "bun:test"
import { type HarnessRow } from "@kiwi/core/harnesses.ts"
import { harnessChoices, LISTED } from "~/live/harness-rows"
import { harnessOf } from "~/live/map"

const row = (harness: HarnessRow["harness"], over: Partial<HarnessRow> = {}): HarnessRow => ({
  harness,
  path: `/bin/${harness}`,
  version: "1.0.0",
  wake: null,
  why: null,
  ...over,
})

describe("the harnesses Settings lists for this computer", () => {
  test("a harness that's there is listed as installed, with its version and path", () => {
    expect(harnessChoices([row("codex")])).toEqual([{ id: "codex", label: "Codex", installed: true, version: "1.0.0", path: "/bin/codex" }])
  })

  test("one that's missing is listed as not installed", () => {
    expect(harnessChoices([row("codex", { path: null, version: null })])).toEqual([{ id: "codex", label: "Codex", installed: false }])
  })

  test("each harness shows once", () => {
    expect(harnessChoices([row("codex"), row("codex", { path: "/other/codex" })]).map((h) => h.path)).toEqual(["/bin/codex"])
  })
})

test("Antigravity CLI is listed by its own name, and its seats show as agy (T2464)", () => {
  expect(harnessChoices([row("agy", { version: "1.4.12" })])).toEqual([{ id: "agy", label: "Antigravity CLI", installed: true, version: "1.4.12", path: "/bin/agy" }])
  expect(harnessOf("antigravity")).toBe("agy")
  expect(LISTED.agy).toBe("agy")
})
