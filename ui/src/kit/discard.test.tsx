import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { DiscardAsk, leaving } from "~/kit/discard"

describe("Esc in an editor asks before it throws edits away (T1865)", () => {
  test("nothing changed: Esc leaves at once", () => {
    expect(leaving(false, false)).toBe("done")
  })

  test("something changed: Esc asks first, and a second Esc keeps editing", () => {
    expect(leaving(false, true)).toBe("ask")
    expect(leaving(true, true)).toBe("keep")
    expect(leaving(true, false)).toBe("keep")
  })

  test("the question offers Keep editing and Discard, with Discard focused", () => {
    const html = renderToStaticMarkup(<DiscardAsk onKeep={() => {}} onDiscard={() => {}} />)
    expect(html).toContain('role="alertdialog"')
    expect(html).toContain("Discard your changes?")
    expect(html.indexOf("Keep editing")).toBeLessThan(html.indexOf(">Discard<"))
    expect(html).toMatch(/<button[^>]*autofocus[^>]*>Discard</i)
  })
})
