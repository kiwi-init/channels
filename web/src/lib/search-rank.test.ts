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

describe("text beyond Latin words", () => {
  const mixed = buildIndex(
    [
      { id: "cjk", text: "我们今天讨论部署方案" },
      { id: "emoji", text: "deploy 🚀 now" },
      { id: "decomposed", text: "migracáo concluída" },
      { id: "mixed", text: "API部署 done" },
    ].map((d) => ({ item: d.id, fields: [{ text: d.text, weight: 1 }] }))
  )
  const found = (query: string) => rank(mixed, query).map((r) => r.item)

  test("a CJK word inside a sentence and an emoji are found", () => {
    expect(found("部署").sort()).toEqual(["cjk", "mixed"])
    expect(found("🚀")).toEqual(["emoji"])
    expect(found("api")).toEqual(["mixed"])
  })

  test("a word written with combining accents is found and marked whole", () => {
    expect(found("migracao")).toEqual(["decomposed"])
    expect(marks("migracáo", terms("migracao"))).toEqual([{ text: "migracáo", hit: true }])
    expect(marks("cáfe", terms("ca"))).toEqual([
      { text: "cá", hit: true },
      { text: "fe", hit: false },
    ])
  })

  test("a CJK match is marked character by character", () => {
    expect(marks("讨论部署方案", terms("部署"))).toEqual([
      { text: "讨论", hit: false },
      { text: "部", hit: true },
      { text: "署", hit: true },
      { text: "方案", hit: false },
    ])
  })

  test("a query with hundreds of words still matches, using its first 32 terms", () => {
    const text = Array.from({ length: 300 }, (_, i) => `term${i}`).join(" ")
    const many = buildIndex([{ item: "exact", fields: [{ text, weight: 1 }] }])
    expect(terms(text)).toHaveLength(32)
    expect(rank(many, text).map((r) => r.item)).toEqual(["exact"])
  })

  test("a snippet cuts at a word boundary, never inside an emoji or after folded accents", () => {
    const emoji = snippet(`${"😀".repeat(20)}${"!".repeat(29)}relay`, terms("relay"))
    expect(emoji).toBe("…relay")
    const accents = snippet(`${"é ".repeat(45)}relay`, terms("relay"))
    expect(accents.endsWith("relay")).toBe(true)
    expect(accents.slice(1).startsWith("é")).toBe(true)
  })
})
