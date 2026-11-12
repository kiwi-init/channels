import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dir, "../styles/shell.css"), "utf8")
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!, body: m[2]! }))
const noDrag = (selectorPart: string): boolean => rules.some((r) => r.selector.includes(selectorPart) && r.body.includes("-webkit-app-region: no-drag"))
const drag = (selectorPart: string): boolean => rules.some((r) => r.selector.includes(selectorPart) && r.body.includes("-webkit-app-region: drag") && !r.body.includes("no-drag"))

describe("interactive rail controls opt out of the window drag region (#2323)", () => {
  test("the Settings gear is never part of a drag region", () => {
    expect(noDrag(".rail-gear")).toBe(true)
    expect(drag(".rail-gear")).toBe(false)
  })

  test("the rail's tiles and the top bar's buttons keep their opt-outs", () => {
    expect(noDrag(".rail .tile")).toBe(true)
    expect(noDrag(".top button")).toBe(true)
  })
})
