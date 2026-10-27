import { describe, expect, test } from "bun:test"
import type { ASTNode } from "react-native-enriched-markdown/lib/typescript/src/web/types"

import { keepParsed, parsedFor } from "~/chat/parsed"

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
