import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { PrCell } from "./pr-cell"

type Pr = NonNullable<Parameters<typeof PrCell>[0]["pr"]>

const pr = (additions: number, deletions: number): Pr => {
  const sized: Pick<Pr, "pr"> = { pr: { repo: "ojowwalker77/channels", number: 476, state: "merged", additions, deletions } as Pr["pr"] }
  return sized as Pr
}

describe("a PR's cell on the Tasks board stays inside its column", () => {
  test("the link clips, the bar is what gives way, and the numbers never shrink", () => {
    const html = renderToStaticMarkup(createElement(PrCell, { pr: pr(449, 262) }))
    expect(html).toContain("overflow-hidden text-meta")
    expect(html).toContain('title="#476 · +449 −262"')
    expect(html).toMatch(/class="[^"]*\bw-12 min-w-0 shrink\b/)
    expect(html).toContain('<span class="shrink-0">#476</span>')
    expect(html).toContain('<span class="shrink-0 text-live">+449</span>')
    expect(html).toContain('<span class="shrink-0 text-alert">−262</span>')
  })

  test("four-digit counts keep their title for hover", () => {
    expect(renderToStaticMarkup(createElement(PrCell, { pr: pr(12840, 3021) }))).toContain('title="#476 · +12840 −3021"')
  })
})
