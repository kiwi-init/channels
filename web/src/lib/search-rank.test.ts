import { describe, expect, test } from "bun:test"

import { buildIndex, marks, rank, snippet, terms } from "./search-rank"

const docs = [
  { id: 1, text: "deploy the relay to staging" },
  { id: 2, text: "the deployment failed on the relay, the relay is down, the relay needs a restart" },
  { id: 3, text: "lunch plans" },
  { id: 4, text: "Revisão da migração do relay" },
]
const index = buildIndex(docs.map((d) => ({ item: d.id, fields: [{ text: d.text, weight: 1 }] })))
const ids = (query: string) => rank(index, query).map((r) => r.item)

describe("BM25 search", () => {
  test("every word of the query must match, and the rarer word weighs more", () => {
    expect(ids("relay staging")).toEqual([1])
    expect(ids("relay lunch")).toEqual([])
    expect(ids("lunch")).toEqual([3])
  })

  test("a word being typed matches as a prefix, an exact word ranks above it", () => {
    expect(ids("deplo").sort()).toEqual([1, 2])
    expect(ids("deploy")[0]).toBe(1)
  })

  test("accents and case do not matter", () => {
    expect(ids("REVISAO migracao")).toEqual([4])
    expect(ids("revisão")).toEqual([4])
  })

  test("a heavier field counts more", () => {
    const weighted = buildIndex([
      {
        item: "body",
        fields: [
          { text: "ana", weight: 1 },
          { text: "fix the relay", weight: 1 },
        ],
      },
      {
        item: "author",
        fields: [
          { text: "relay", weight: 2 },
          { text: "lunch", weight: 1 },
        ],
      },
    ])
    expect(rank(weighted, "relay").map((r) => r.item)).toEqual(["author", "body"])
  })

  test("an empty query or one with only punctuation finds nothing", () => {
    expect(ids("")).toEqual([])
    expect(ids(" ?! ")).toEqual([])
  })
})

describe("marks and snippets", () => {
  test("marks the matched prefix of each word, keeping the original accents", () => {
    expect(marks("Deploying the relay", terms("deploy rel"))).toEqual([
      { text: "Deploy", hit: true },
      { text: "ing the ", hit: false },
      { text: "rel", hit: true },
      { text: "ay", hit: false },
    ])
    expect(marks("A migração", terms("migracao"))).toEqual([
      { text: "A ", hit: false },
      { text: "migração", hit: true },
    ])
  })

  test("does not mark a match inside a word", () => {
    expect(marks("redeploy", terms("deploy"))).toEqual([{ text: "redeploy", hit: false }])
  })

  test("a snippet starts near the first match of a long text", () => {
    const long = `${"word ".repeat(40)}the relay broke`
    const cut = snippet(long, terms("relay"))
    expect(cut.startsWith("…")).toBe(true)
    expect(cut).toContain("the relay broke")
    expect(cut.length).toBeLessThan(long.length)
    expect(snippet("short relay note", terms("relay"))).toBe("short relay note")
  })
})
