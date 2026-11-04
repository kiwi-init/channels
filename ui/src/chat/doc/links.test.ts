import { describe, expect, test } from "bun:test"
import { linkParts, linksIn, openLink, type DocLink } from "~/chat/doc/links"
import { schema } from "~/chat/doc/schema"

const { doc, block, paragraph, code_block, mention } = schema.nodes
const T = 1_700_000_000_000

function page(...paras: ReturnType<typeof paragraph.create>[]) {
  return doc.create(null, [block.create({ id: "AAAAAAAAAAAAAAAAAAAAAA", kind: "text", author: "jow", at: T }, paras)])
}

const p = (text: string) => paragraph.create(null, schema.text(text))
const shown = (d: ReturnType<typeof page>, l: DocLink) => ({ href: l.href, text: d.textBetween(l.from, l.to), label: d.textBetween(l.label.from, l.label.to) })

describe("links in the thread doc", () => {
  test("a bare URL is a link, without the sentence's trailing punctuation", () => {
    const d = page(p("deployed to https://example.com/a?b=1. Next (see https://example.com/x_(y)), done"))
    expect(linksIn(d).map((l) => shown(d, l))).toEqual([
      { href: "https://example.com/a?b=1", text: "https://example.com/a?b=1", label: "https://example.com/a?b=1" },
      { href: "https://example.com/x_(y)", text: "https://example.com/x_(y)", label: "https://example.com/x_(y)" },
    ])
  })

  test("a markdown link shows its label and keeps its URL", () => {
    const d = page(p("read [the spec](https://example.com/spec) and [mail](mailto:a@b.co)"))
    expect(linksIn(d).map((l) => shown(d, l))).toEqual([
      { href: "https://example.com/spec", text: "[the spec](https://example.com/spec)", label: "the spec" },
      { href: "mailto:a@b.co", text: "[mail](mailto:a@b.co)", label: "mail" },
    ])
  })

  test("code, other schemes and positions after a mention", () => {
    const d = page(
      paragraph.create(null, [mention.create({ name: "atlas" }), schema.text(" see https://example.com/m")]),
      paragraph.create(null, [schema.text("https://example.com/code", [schema.marks.code.create()])]),
      p("[x](javascript:alert(1)) ftp://example.com"),
      code_block.create(null, schema.text("curl https://example.com/block"))
    )
    expect(linksIn(d).map((l) => shown(d, l))).toEqual([{ href: "https://example.com/m", text: "https://example.com/m", label: "https://example.com/m" }])
  })

  test("a markdown link's syntax folds away unless the selection touches it", () => {
    const d = page(p("a [docs](https://example.com) b https://example.com/bare"))
    const links = linksIn(d)
    const md = links[0]!
    const parts = (open: number) => linkParts(links, open).map((x) => [x.part, d.textBetween(x.from, x.to), x.folded])
    expect(parts(openLink(links, { from: 1, to: 1 }))).toEqual([
      ["syntax", "[", true],
      ["label", "docs", false],
      ["syntax", "](https://example.com)", true],
      ["label", "https://example.com/bare", false],
    ])
    expect(openLink(links, { from: md.from + 3, to: md.from + 3 })).toBe(0)
    expect(openLink(links, { from: md.to, to: md.to })).toBe(0)
    expect(parts(0).filter(([, , folded]) => folded)).toEqual([])
  })
})
