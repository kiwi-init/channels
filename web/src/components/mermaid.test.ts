import { describe, expect, test } from "bun:test"

import { drawCached } from "./mermaid"

describe("drawing a Mermaid diagram", () => {
  test("is done once per source and color scheme, and a remount reuses it", async () => {
    let drawn = 0
    const render = async (s: string) => (drawn++, { kind: "svg" as const, svg: `<svg>${s}</svg>` })
    const a = drawCached("graph TD; A-->B", "light-one", render)
    expect(drawCached("graph TD; A-->B", "light-one", render)).toBe(a)
    expect(await a).toEqual({ kind: "svg", svg: "<svg>graph TD; A-->B</svg>" })
    await drawCached("graph TD; A-->B", "dark-one", render)
    expect(drawn).toBe(2)
  })

  test("a source over 20,000 characters is never drawn", async () => {
    let drawn = 0
    const got = await drawCached(`graph TD;${"A-->B;".repeat(4_000)}`, "light-two", async () => (drawn++, { kind: "svg" as const, svg: "" }))
    expect(drawn).toBe(0)
    expect(got).toMatchObject({ kind: "error", message: expect.stringContaining("too long to draw") })
  })

  test("keeps at most 100 drawings, dropping the one used longest ago", async () => {
    let drawn = 0
    const render = async () => (drawn++, { kind: "svg" as const, svg: "" })
    for (let i = 0; i < 101; i++) await drawCached(`graph ${i}`, "evict", render)
    expect(drawn).toBe(101)
    await drawCached("graph 100", "evict", render)
    expect(drawn).toBe(101)
    await drawCached("graph 0", "evict", render)
    expect(drawn).toBe(102)
  })
})
