import { describe, expect, test } from "bun:test"
import { HARNESS_INSTALL, type HarnessRow } from "@kiwi/core/harnesses.ts"
import { harnessChoices, STARTS } from "~/live/harness-rows"

const row = (harness: HarnessRow["harness"], over: Partial<HarnessRow> = {}): HarnessRow => ({
  harness,
  path: `/bin/${harness}`,
  version: "1.0.0",
  start: true,
  wake: null,
  why: null,
  options: null,
  ...over,
})

describe("the harnesses a computer can start (T429)", () => {
  test("a harness that's there and can start is offered as installed, with its version and path", () => {
    expect(harnessChoices([row("codex")])).toEqual([{ id: "codex", label: "Codex", installed: true, version: "1.0.0", path: "/bin/codex" }])
  })

  test("one that's missing or can't start is listed as not installed, saying why", () => {
    const [missing, refused] = harnessChoices([row("codex", { path: null, version: null }), row("claude-code", { start: false, why: "needs a newer version" })])
    expect(missing).toMatchObject({ id: "codex", installed: false })
    expect(refused).toMatchObject({ installed: false, why: "needs a newer version" })
  })

  test("each harness shows once", () => {
    expect(harnessChoices([row("codex"), row("codex", { path: "/other/codex" })]).map((h) => h.path)).toEqual(["/bin/codex"])
  })
})

test("a harness the app can show but not start yet isn't offered", () => {
  expect(harnessChoices([row("kimi"), row("mimo"), row("pi"), row("codex")]).map((h) => h.id)).toEqual(["codex"])
})

test("every harness the app can start has a line that installs it (T375)", () => {
  expect(Object.values(STARTS).filter((h) => !HARNESS_INSTALL[h])).toEqual([])
})
