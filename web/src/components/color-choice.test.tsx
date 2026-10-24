import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import type { Color } from "@kiwi/core/protocol.ts"
import { ColorChoice } from "./color-choice"

const html = (value: Color | null, taken: [Color, string][] = []) => renderToStaticMarkup(createElement(ColorChoice, { value, taken: new Map(taken), onPick: () => {} }))

describe("a person's colour picker (T16)", () => {
  test("offers no colour and the ten colours color.set takes, with the current one checked", () => {
    const out = html("teal")
    expect(out.match(/role="radio"/g)).toHaveLength(11)
    expect(out).toContain('aria-checked="true" aria-label="teal"')
    expect(out).toContain('aria-checked="false" aria-label="No colour"')
  })

  test("a colour another person holds can't be picked, and says whose it is, as the fold refuses it", () => {
    const out = html(null, [["blue", "Pat"]])
    expect(out).toContain('aria-label="blue, Pat&#x27;s" title="Pat&#x27;s colour" disabled=""')
    expect(out).not.toMatch(/aria-label="red"[^>]*disabled=""/)
  })
})
