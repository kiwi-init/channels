import { describe, expect, test } from "bun:test"

import { specMatches } from "~/chat/matches"
import type { Spec } from "~/model"
import { wrote } from "~/words"

describe("# also finds specs (T1875)", () => {
  const spec = (ask: number, title: string, more: Partial<Spec> = {}): Spec =>
    ({
      ask,
      title: wrote(title),
      words: wrote(title),
      by: "jow",
      at: 0,
      text: wrote(title),
      v: 1,
      edited: { by: "jow", at: ask },
      edits: 0,
      editors: [],
      stage: "draft",
      backs: [],
      tasks: [],
      ...more,
    }) as Spec
  const specs = [spec(150, "Export the board"), spec(160, "Drafts survive a restart"), spec(170, "Release notes", { result: { by: "jow", at: 1, verdict: "accepted" } })]

  test("by a word of the title or by its number", () => {
    expect(specMatches(specs, "draft").map((s) => s.ask)).toEqual([160])
    expect(specMatches(specs, "restart").map((s) => s.ask)).toEqual([160])
    expect(specMatches(specs, "15").map((s) => s.ask)).toEqual([150])
    expect(specMatches(specs, "zzz")).toEqual([])
  })

  test("nothing typed lists them, open ones before closed ones, newest edit first", () => {
    expect(specMatches(specs, "").map((s) => s.ask)).toEqual([160, 150, 170])
  })
})
