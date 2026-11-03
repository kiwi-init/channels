import { describe, expect, test } from "bun:test"
import { cleanExcerpt, excerptIn, excerptOf, MAX_EXCERPT, quotedExcerpt, withExcerpt } from "~/chat/quote"

describe("a selected excerpt", () => {
  test("is trimmed, keeps its line breaks, and loses runs of blank lines", () => {
    expect(cleanExcerpt("  the build is green  \n")).toBe("the build is green")
    expect(cleanExcerpt("one\r\n\r\n\r\n\r\ntwo  \nthree")).toBe("one\n\ntwo\nthree")
    expect(cleanExcerpt(" \n\t ")).toBe("")
  })

  test("is cut to a readable length", () => {
    const cut = cleanExcerpt("word ".repeat(400))
    expect(cut.length).toBeLessThanOrEqual(MAX_EXCERPT)
    expect(cut.endsWith("…")).toBe(true)
  })
})

describe("the message a quote sends", () => {
  test("is the excerpt as a Markdown quote, a blank line, then what you said", () => {
    expect(withExcerpt("run it once at the end", "Why not after each step?")).toBe("> run it once at the end\n\nWhy not after each step?")
    expect(withExcerpt("line one\n\nline two", "ok")).toBe("> line one\n>\n> line two\n\nok")
    expect(withExcerpt("just this", "  ")).toBe("> just this")
  })

  test("reads back as the excerpt and the rest", () => {
    expect(excerptOf(withExcerpt("line one\n\nline two", "and so?"))).toEqual({ excerpt: "line one\n\nline two", rest: "and so?" })
    expect(excerptOf("> only a quote")).toEqual({ excerpt: "only a quote", rest: "" })
    expect(excerptOf("no quote here\n> later")).toBeNull()
    expect(excerptOf("> [!NOTE]\n> an admonition")).toBeNull()
    expect(excerptOf(">\n>\n\ntext")).toBeNull()
  })
})

describe("an excerpt of the message it answers", () => {
  const quoted = { text: "Yes. I'll run **the tests** once at the end, see [the log](https://example.com/log), instead of after each step." }

  test("matches what the reader saw, without the Markdown", () => {
    expect(excerptIn("run the tests once at the end", quoted.text)).toBe(true)
    expect(excerptIn("see the log", quoted.text)).toBe(true)
    expect(excerptIn("Run The Tests", quoted.text)).toBe(true)
    expect(excerptIn("something else entirely", quoted.text)).toBe(false)
    expect(excerptIn("", quoted.text)).toBe(false)
  })

  test("is shown as the quote only when it is in that message", () => {
    expect(quotedExcerpt({ text: "> once at the end\n\nWhy?" }, quoted)).toEqual({ excerpt: "once at the end", rest: "Why?" })
    expect(quotedExcerpt({ text: "> a line from elsewhere\n\nWhy?" }, quoted)).toBeNull()
    expect(quotedExcerpt({ text: "> once at the end\n\nWhy?" }, undefined)).toBeNull()
    expect(quotedExcerpt({ text: `> ${"x".repeat(10)}…\n\nhm` }, { text: "x".repeat(40) })).toEqual({ excerpt: `${"x".repeat(10)}…`, rest: "hm" })
  })
})
