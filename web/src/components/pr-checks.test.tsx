import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ChecksWord } from "./pr-checks"

const html = (passed: number, failed: string[], running: number) => renderToStaticMarkup(createElement(ChecksWord, { checks: { passed, failed, running } }))

describe("a PR's checks in a word", () => {
  test("a failure first, by name when it's one; then what's running; else passed", () => {
    expect(html(3, ["ci-ok"], 1)).toContain("ci-ok failed")
    expect(html(1, ["a", "b"], 0)).toContain("2 checks failed")
    expect(html(2, [], 1)).toContain("1 running")
    expect(html(4, [], 0)).toContain("checks passed")
  })
})
