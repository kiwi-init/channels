import { describe, expect, test } from "bun:test"

import { drawnKinds, SHOWN_MAX_BYTES, shownIn } from "~/mods/shown"

const file = (name: string, size = 100) => ({ name, size })

describe("attachments a mod draws (T6869)", () => {
  test("a kind is drawn by the first mod that's on and asks for render:<kind>", () => {
    const kinds = drawnKinds([
      { name: "zeta", state: "on", needs: ["render:figure"] },
      { name: "anatomy", state: "on", needs: ["panel", "render:figure"] },
      { name: "charts", state: "asks", needs: ["render:chart"] },
      { name: "maps", state: "on", needs: ["render:map", "net:example.com"] },
    ])
    expect([...kinds]).toEqual([
      ["figure", "anatomy"],
      ["map", "maps"],
    ])
  })

  test("X.K.html and X.K.svg make one drawn attachment, with X.K-light.html as its light page; the rest stay files", () => {
    const files = [
      file("notes.pdf"),
      file("gauge.figure.svg"),
      file("gauge.figure.html"),
      file("gauge.figure-light.html"),
      file("lone.figure.html"),
      file("chart.chart.html"),
      file("chart.chart.svg"),
      file("dark.figure-light.svg"),
    ]
    const { shown, rest } = shownIn(files, new Set(["figure"]))
    expect(shown).toEqual([{ kind: "figure", name: "gauge", page: files[2]!, light: files[3]!, snapshot: files[1]! }])
    expect(rest.map((f) => f.name)).toEqual(["notes.pdf", "lone.figure.html", "chart.chart.html", "chart.chart.svg", "dark.figure-light.svg"])
  })

  test("a figure without a light page is drawn from its one page, and two figures in a message are both drawn", () => {
    const files = [file("a.figure.html"), file("a.figure.svg"), file("b.figure.html"), file("b.figure.svg")]
    expect(shownIn(files, new Set(["figure"])).shown.map((s) => [s.name, s.light])).toEqual([
      ["a", null],
      ["b", null],
    ])
  })

  test("over 8 MB in all, or a kind no mod draws, stays plain files", () => {
    const big = [file("big.figure.html", SHOWN_MAX_BYTES - 50), file("big.figure.svg", 100)]
    expect(shownIn(big, new Set(["figure"]))).toEqual({ shown: [], rest: big })
    const fits = [file("ok.figure.html", SHOWN_MAX_BYTES - 100), file("ok.figure.svg", 100)]
    expect(shownIn(fits, new Set(["figure"])).shown).toHaveLength(1)
    expect(shownIn(fits, new Set(["chart"])).rest).toEqual(fits)
  })
})
