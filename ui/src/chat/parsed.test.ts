import { describe, expect, test } from "bun:test"
import type { ASTNode } from "react-native-enriched-markdown/lib/typescript/src/web/types"

import { keepParsed, linked, parsedFor } from "~/chat/parsed"

const ast = (content: string): ASTNode => ({ type: "Document", children: [{ type: "Text", content }] })

describe("markdown parsed once and kept", () => {
  test("a kept tree comes back for the same markdown, not for another", () => {
    const tree = ast("hello")
    keepParsed("hello **there**", tree)
    expect(parsedFor("hello **there**")).toBe(tree)
    expect(parsedFor("hello there")).toBeUndefined()
  })

  test("the oldest trees go first once there are more than 800", () => {
    keepParsed("first", ast("first"))
    for (let i = 0; i < 800; i++) keepParsed(`filler ${i}`, ast(String(i)))
    expect(parsedFor("first")).toBeUndefined()
    expect(parsedFor("filler 799")).toBeDefined()
  })

  test("reading a tree again keeps it from being the oldest", () => {
    keepParsed("kept", ast("kept"))
    for (let i = 0; i < 799; i++) keepParsed(`more ${i}`, ast(String(i)))
    keepParsed("kept", ast("kept again"))
    keepParsed("one more", ast("one more"))
    expect(parsedFor("kept")).toBeDefined()
  })
})

describe("mentions and tasks become links before parsing", () => {
  test("known names and tasks link, unknown ones and code stay as written", () => {
    const names = new Set(["atlas"])
    const tasks = new Set([12])
    expect(linked("@atlas take T12, not T13 or @nobody", names, tasks)).toBe("[@atlas](kiwi-mention:atlas) take [T12](kiwi-task:12), not T13 or @nobody")
    expect(linked("`@atlas T12`", names, tasks)).toBe("`@atlas T12`")
    expect(linked("```\n@atlas T12\n```", names, tasks)).toBe("```\n@atlas T12\n```")
  })
})
