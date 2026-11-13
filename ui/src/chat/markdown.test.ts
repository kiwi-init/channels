import { describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createElement, type CSSProperties } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import * as shim from "~/chat/react-native"

void mock.module("react-native", () => shim)
Object.assign(globalThis, { __DEV__: false })

const { normalizeMarkdownStyle } = await import("react-native-enriched-markdown/lib/module/normalizeMarkdownStyle.web.js")
const { buildStyles } = await import("react-native-enriched-markdown/lib/module/web/styles.js")
const { parseMarkdown } = await import("react-native-enriched-markdown/lib/module/web/parseMarkdown.js")
const { RenderNode } = await import("react-native-enriched-markdown/lib/module/web/renderers/index.js")
const { default: Markdown, blockGaps, withTextSize, safeLinks, sortedRows, warm } = await import("~/chat/markdown")
const { parseKey } = await import("~/chat/parsed")
const { zonedLinks } = await import("~/chat/zoned-times")
const { keepParsed, parsedFor } = await import("~/chat/parsed")

const fixed = (name: string, s: CSSProperties): string[] => [
  ...(typeof s.fontSize === "number" ? [`${name} fontSize ${s.fontSize}`] : []),
  ...(typeof s.lineHeight === "string" && s.lineHeight.endsWith("px") ? [`${name} lineHeight ${s.lineHeight}`] : []),
]

describe("message text follows Settings > Appearance > Text size", () => {
  test("every markdown style that sets a size scales with the root font size", () => {
    const styles = withTextSize(buildStyles(normalizeMarkdownStyle({ paragraph: { fontSize: 15, lineHeight: 22 } })))
    const left = Object.entries(styles).flatMap(([name, s]) => ("left" in s ? Object.entries(s).flatMap(([align, cell]) => fixed(`${name}.${align}`, cell)) : fixed(name, s)))
    expect(left).toEqual([])
    expect(styles.paragraph).toMatchObject({ fontSize: "0.9375rem", lineHeight: "1.375rem" })
  })

  test("a callout's title, which the renderer sizes inline, scales through chat.css", async () => {
    const style = normalizeMarkdownStyle({ blockquote: { fontSize: 15 } })
    const ast = await parseMarkdown("> [!WARNING]\n> careful", { latexMath: false, underline: false })
    const html = renderToStaticMarkup(
      createElement(RenderNode, { node: ast.children?.[0] ?? ast, style, styles: withTextSize(buildStyles(style)), callbacks: {}, capabilities: { katex: null, enableTaskListItemToggle: false } })
    )
    expect(html).toMatch(/<div class="enrm-admonition"[^>]*><div style="[^"]*font-size:15px[^"]*"><svg[\s\S]*?<\/svg><span>Warning<\/span><\/div>/)
    const css = readFileSync(join(import.meta.dir, "../styles/chat.css"), "utf8")
    expect(css).toContain(".md .enrm-admonition > div:first-child > span {\n  font-size: var(--t-body);\n}")
  })
})

describe("message text can be selected and seen", () => {
  test("the renderer's selection colour is set wherever a message is drawn", () => {
    const library = readFileSync(Bun.fileURLToPath(import.meta.resolve("react-native-enriched-markdown/lib/module/web/globalStyles.js")), "utf8")
    const rule = /`\.\$\{ENRM_TEXT_CLASS\} ::selection \{ background-color: var\(\$\{ENRM_SELECTION_BG_VAR\}\); \}`/
    expect(library).toMatch(rule)
    const name = /ENRM_SELECTION_BG_VAR = '([^']+)'/.exec(library)?.[1]
    expect(name).toBe("--enrm-selection-bg")
    const css = readFileSync(join(import.meta.dir, "../styles/chat.css"), "utf8")
    expect(css).toContain(`.md {\n  ${name}: var(--selection);\n}`)
  })
})

describe("a message keeps the lines it was written in (T616)", () => {
  test("one newline is a line break, not a space", async () => {
    const source = readFileSync(join(import.meta.dir, "markdown.tsx"), "utf8")
    expect(source).toContain("const FLAGS = { latexMath: false, underline: false, hardSoftBreaks: true }")
    const ast = await parseMarkdown("Done: tests\nNext: shots", { latexMath: false, underline: false, hardSoftBreaks: true })
    const html = renderToStaticMarkup(
      createElement(RenderNode, {
        node: ast.children?.[0] ?? ast,
        style: normalizeMarkdownStyle({}),
        styles: buildStyles(normalizeMarkdownStyle({})),
        callbacks: {},
        capabilities: { katex: null, enableTaskListItemToggle: false },
      })
    )
    expect(html).toMatch(/tests<br\/?>Next: shots/)
  })
})

type Shape = { type: string; children?: Shape[]; content?: string }
const shape = (node: Shape): string => (node.type === "Text" ? (node.content ?? "") : `${node.type}(${(node.children ?? []).map(shape).join(" ")})`)

describe("a line after a list is its own paragraph, not glued onto the last item (T4145)", () => {
  test("an unindented line right after a bulleted or numbered list starts a new paragraph", async () => {
    const source = readFileSync(join(import.meta.dir, "markdown.tsx"), "utf8")
    expect(source).toContain("parseMarkdown(blockGaps(markdown), FLAGS)")
    const bullets = await parseMarkdown(blockGaps("Waits for:\n\n- #1713: rerun\n- T4114: red\nThen: full CI"), FLAGS)
    expect((bullets.children ?? []).map(shape)).toEqual(["Paragraph(Waits for:)", "UnorderedList(ListItem(Paragraph(#1713: rerun)) ListItem(Paragraph(T4114: red)))", "Paragraph(Then: full CI)"])
    const numbered = await parseMarkdown(blockGaps("1. build\n2. ship\nDone."), FLAGS)
    expect((numbered.children ?? []).map((n) => n.type)).toEqual(["OrderedList", "Paragraph"])
  })

  test("an indented line, a nested list, a blank-separated paragraph and a fenced block are left as written", () => {
    for (const text of ["- a\n  more of a\n  - nested\n- b", "- a\n\n  still a\n\nafter", "- a\n\nafter", "```\n- a\nb\n```", "~~~md\n- a\n```\nb\n~~~\nc", "plain\ntext"])
      expect(blockGaps(text)).toBe(text)
    expect(blockGaps("- a\n```\n- b\nc\n```")).toBe("- a\n\n```\n- b\nc\n```")
  })
})

describe("a table right under a line of text is a table, as on GitHub (T7015)", () => {
  test("the table after a text line, a list or a bold label parses as a table", async () => {
    for (const lead of ["Per the spec, the valid values are:", "**Per the spec:**", "- one item"]) {
      const ast = await parseMarkdown(blockGaps(`${lead}\n| Value | Done when |\n|---|---|\n| none | approved |\n| merge | it merges |`), FLAGS)
      const table = (ast.children ?? []).find((n) => n.type === "Table")
      expect(table && shape(table)).toBe(
        "Table(TableHead(TableRow(TableHeaderCell(Value) TableHeaderCell(Done when))) TableBody(TableRow(TableCell(none) TableCell(approved)) TableRow(TableCell(merge) TableCell(it merges))))"
      )
    }
  })

  test("the first line after the table without a pipe is text again, not one more row", async () => {
    const ast = await parseMarkdown(blockGaps("Values:\n| a | b |\n|---|---|\n| 1 | 2 |\nThat's all.\n- and a list"), FLAGS)
    expect((ast.children ?? []).map((n) => n.type)).toEqual(["Paragraph", "Table", "Paragraph", "UnorderedList"])
    expect(blockGaps("| a |\n|---|\n| 1 |\nafter")).toBe("| a |\n|---|\n| 1 |\n\nafter")
  })

  test("a delimiter row without pipes, aligned columns and a table that already has its gap work too", async () => {
    expect(blockGaps("Totals:\na | b\n:--- | ---:\n1 | 2")).toBe("Totals:\n\na | b\n:--- | ---:\n1 | 2")
    expect(blockGaps("Totals:\n\n| a | b |\n|---|---|")).toBe("Totals:\n\n| a | b |\n|---|---|")
    expect(blockGaps("| a | b |\n|---|---|\n| 1 | 2 |")).toBe("| a | b |\n|---|---|\n| 1 | 2 |")
  })

  test("a heading underline, a pipe in a sentence and a table inside a code fence are left as written", () => {
    for (const text of ["a | b\n---", "use a | b here\nand more", "a | b\n- c", "Run:\n```\n| a | b |\n|---|---|\n```", "~~~\nx\n| a |\n|---|\n~~~"]) expect(blockGaps(text)).toBe(text)
  })
})

describe("a code block copies when it's pressed", () => {
  test("the block is the button, with its language in the label, and no copy buttons laid over it", async () => {
    const markdown = "Run it:\n\n```sh\nbun test\n```"
    const ast = await parseMarkdown(markdown, { latexMath: false, underline: false })
    keepParsed(markdown, ast)
    const quiet = () => {}
    const html = renderToStaticMarkup(createElement(Markdown, { markdown, onMention: quiet, onTask: quiet, onMessage: quiet, onImage: quiet, onShown: quiet, copied: quiet }))
    expect(html).toMatch(/<pre style="[^"]*cursor:pointer[^"]*" aria-label="Code block: sh" role="button" tabindex="0"><code[^>]*>bun test/)
    expect(html).not.toContain("md-copy")
  })

  test("a hint says Copy on hover and on keyboard focus, and doesn't take the click", () => {
    const css = readFileSync(join(import.meta.dir, "../styles/chat.css"), "utf8")
    expect(css).toContain('.md pre[role="button"]::after {\n  content: "Copy";')
    expect(css).toContain('.msg:hover .md pre[role="button"]::after,\n.md pre[role="button"]:focus-visible::after {\n  opacity: 1;\n}')
    expect(css).toMatch(/\.md pre\[role="button"\]::after \{[^}]*pointer-events: none;/)
  })
})

const quiet = () => {}
const FLAGS = { latexMath: false, underline: false, hardSoftBreaks: true }

async function rendered(markdown: string, at?: number): Promise<string> {
  const ast = await parseMarkdown(markdown, FLAGS)
  zonedLinks(ast, at)
  safeLinks(ast)
  keepParsed(parseKey(markdown, at), ast)
  return renderToStaticMarkup(createElement(Markdown, { markdown, at, onMention: quiet, onTask: quiet, onMessage: quiet, onImage: quiet, onShown: quiet, copied: quiet }))
}

describe("a link that hides a user name or password stays text (T216)", () => {
  test("user:pass@ links lose their href, plain and mention links keep theirs", async () => {
    const html = await rendered("[docs](https://user:pass@evil.example/x) and https://me:secret@evil.example and [ok](https://example.com) and [@ana](kiwi-mention:ana)")
    expect(html).not.toContain('evil.example/x"')
    expect(html).not.toMatch(/href="[^"]*secret@/)
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('href="kiwi-mention:ana"')
    expect(html).toContain("docs")
  })

  test("javascript: links stay text", async () => {
    expect(await rendered("[x](javascript:alert(1))")).not.toContain("href=")
  })
})

describe("the renderer only links what a click opens, and never loads a remote picture (#1308)", () => {
  test("a link keeps its href only for http(s), mailto and Kiwi's own links", async () => {
    const html = await rendered("[call](tel:123) <tel:456> [mail](mailto:a@b.example) [site](https://ok.example) [file](file:///etc/passwd) [@ana](kiwi-mention:ana)")
    expect(html).not.toContain('href="tel:')
    expect(html).not.toContain('href="file:')
    expect(html).toContain('href="mailto:a@b.example"')
    expect(html).toContain('href="https://ok.example"')
    expect(html).toContain('href="kiwi-mention:ana"')
    expect(html).toContain("call")
  })

  test("a remote picture, inline, by reference or in a table, is a link named by its alt", async () => {
    const html = await rendered("![a *b*](https://evil.example/a.png)\n\n![r][ref]\n\n| x |\n| - |\n| ![t](https://evil.example/t.png) |\n\n[ref]: https://evil.example/ref.png")
    expect(html).not.toContain("<img")
    expect(html).not.toContain('rel="preload"')
    expect(html).toContain('href="https://evil.example/a.png"')
    expect(html).toContain(">a b</a>")
    expect(html).toContain(">r</a>")
    expect(html).toContain(">t</a>")
  })

  test("a picture at an address a click wouldn't open is its alt text; one inside the message stays a picture", async () => {
    const html = await rendered("![x](javascript:alert(1)) ![y](file:///tmp/y.png)\n\n![d](data:image/png;base64,AAAA)")
    expect(html).not.toContain("javascript:")
    expect(html).not.toContain("file:")
    expect(html).toContain('<img src="data:image/png;base64,AAAA"')
  })

  test("a remote picture inside a link is its alt text, so the link around it stays the only one", async () => {
    const html = await rendered("[![thumb *x*][pic]](https://destination.example) [![p](https://images.example/b.png)](https://two.example)\n\n[pic]: https://images.example/a.png")
    expect(html).not.toContain("<img")
    expect(html).not.toContain("images.example")
    expect(html).not.toMatch(/<a[^>]*>(?:(?!<\/a>).)*<a/)
    expect(html).toMatch(/<a href="https:\/\/destination.example"[^>]*>thumb x<\/a>/)
    expect(html).toMatch(/<a href="https:\/\/two.example"[^>]*>p<\/a>/)
  })
})

describe("a table sorts on a header click (T216)", () => {
  test("every header is a button that says what it sorts by", async () => {
    const html = await rendered("| Name | Runs |\n| --- | ---: |\n| b | 10 |\n| a | 2 |")
    expect(html).toMatch(/<th scope="col" style="[^"]*" aria-sort="none"><button type="button" class="md-sort" aria-label="Sort by Name">Name<span aria-hidden="true"><\/span><\/button><\/th>/)
    expect(html).toContain('aria-label="Sort by Runs"')
    expect(html).toMatch(/<td[^>]*>b<\/td><td[^>]*>10<\/td><\/tr><tr[^>]*><td[^>]*>a<\/td>/)
  })

  test("numbers sort as numbers, text as text, ties keep the author's order, and no sort is the author's order", async () => {
    const ast = await parseMarkdown("| n | w |\n| - | - |\n| 10 | b |\n| 2 | a |\n| 9 | b |\n| 1,000 | a |", FLAGS)
    const body = ast.children?.[0]?.children?.find((c) => c.type === "TableBody")?.children ?? []
    expect(sortedRows(body, null)).toEqual([0, 1, 2, 3])
    expect(sortedRows(body, { column: 0, direction: "asc" })).toEqual([1, 2, 0, 3])
    expect(sortedRows(body, { column: 0, direction: "desc" })).toEqual([3, 0, 2, 1])
    expect(sortedRows(body, { column: 1, direction: "asc" })).toEqual([1, 3, 0, 2])
  })
})

describe("long inline code copies and wide code fades (T216)", () => {
  test("inline code from 16 characters becomes a Copy button; the block's own copy stays", () => {
    const source = readFileSync(join(import.meta.dir, "markdown.tsx"), "utf8")
    expect(source).toContain("const COPYABLE = 16")
    expect(source).toContain('if (code.closest("pre, a") || text.length < COPYABLE || text.includes("\\n")) continue')
  })

  test("a code block wider than the message fades at the right edge, and the Copy hint stays sharp over it", () => {
    const css = readFileSync(join(import.meta.dir, "../styles/chat.css"), "utf8")
    expect(css).toContain(".md pre.code-more {\n  mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent);\n}")
    expect(css).toContain('.msg:hover .md pre.code-more[role="button"],\n.md pre.code-more[role="button"]:focus-visible {')
    expect(css).toContain(".md code[data-copy] {\n  cursor: copy;\n}")
  })
})

describe("a link to a message keeps its href; other kiwi:// links don't (T987)", () => {
  test("only the message form survives", async () => {
    const code = "mc2-4u2dwIeijB9T9jh4JERA4Q-62qozsSxRQzg3q6a"
    const html = await rendered(`[message #12](<kiwi://join/${code}?m=12>) and [join](<kiwi://join/${code}>) and [odd](<kiwi://other/x?m=1>)`)
    expect(html).toContain(`href="kiwi://join/${code}?m=12"`)
    expect(html).not.toContain(`href="kiwi://join/${code}"`)
    expect(html).not.toContain('href="kiwi://other')
  })
})

describe("a UTC time in prose shows its local time (#2367)", () => {
  test("recognized times become kiwi-utc links whose text stays the original token", async () => {
    const at = Date.UTC(2030, 0, 16, 22)
    const html = await rendered("standup 06:30Z, review 2030-01-16T01:15:00Z, plain 06:30 stays, `07:00Z` too, 25:00Z wrong", at)
    expect(html).toContain('href="kiwi-utc:2030-01-16T06:30:00Z"')
    expect(html).toContain('href="kiwi-utc:2030-01-16T01:15:00Z"')
    expect(html).toContain(">06:30Z</a>")
    expect(html).toContain(">2030-01-16T01:15:00Z</a>")
    expect(html.match(/kiwi-utc:/g)?.length).toBe(2)
  })

  test("bold text, list items and table cells convert; code and links hold their structure", async () => {
    const at = Date.UTC(2030, 0, 16, 22)
    const bold = await rendered("**deal at 06:30Z**", at)
    expect(bold).toContain('href="kiwi-utc:2030-01-16T06:30:00Z"')
    const list = await rendered("- first 06:30Z\n- second 23:45Z", at)
    expect(list).toContain('href="kiwi-utc:2030-01-16T06:30:00Z"')
    expect(list).toContain('href="kiwi-utc:2030-01-16T23:45:00Z"')
    const table = await rendered("| when |\n| --- |\n| 06:30Z |", at)
    expect(table).toContain('href="kiwi-utc:2030-01-16T06:30:00Z"')
  })

  test("code blocks hold their structure: plain, in a list, behind a shorter fence line, and in a blockquote", async () => {
    const at = Date.UTC(2030, 0, 16, 22)
    for (const text of ["```\n06:30Z\n```", "~~~~\n~~~\n06:30Z\n~~~~", "- ~~~\n  06:30Z\n  ~~~", "> ~~~\n> 06:30Z\n> ~~~", "run `06:30Z` locally", "``a ` 06:30Z`` stays code"]) {
      const html = await rendered(text, at)
      expect(html).toContain("06:30Z")
      expect(html).not.toContain("kiwi-utc:")
    }
  })

  test("links hold their structure: inline and reference links keep their labels and destinations", async () => {
    const at = Date.UTC(2030, 0, 16, 22)
    const inline = await rendered("[06:30Z](https://example.com) stays one link", at)
    expect(inline).toContain('href="https://example.com"')
    expect(inline).toContain(">06:30Z</a>")
    expect(inline).not.toContain("kiwi-utc")
    const reference = await rendered("[06:30Z][meeting]\n\n[meeting]: https://example.com", at)
    expect(reference).toContain('href="https://example.com"')
    expect(reference).not.toContain("kiwi-utc")
  })

  test("a time-only token without a message date stays unconverted", async () => {
    const html = await rendered("standup 06:30Z ok?")
    expect(html).toContain("06:30Z")
    expect(html).not.toContain("kiwi-utc:")
  })
})

describe("a hand-written kiwi-utc link survives validation (#2367)", () => {
  test("a malformed instant loses its href and renders as plain text", async () => {
    const html = await rendered("[bad](kiwi-utc:garbage) and [ok](kiwi-utc:2030-01-16T01:15:00Z)")
    expect(html).not.toContain("kiwi-utc:garbage")
    expect(html).toContain("bad and ")
    expect(html).toContain('href="kiwi-utc:2030-01-16T01:15:00Z"')
  })
})

describe("a warmed message is parsed under the key its render looks up (T7429)", () => {
  test("warming with each message's time fills parseKey(markdown, at), with or without a UTC time in it", async () => {
    const at = Date.UTC(2026, 10, 12, 15, 0)
    const messages = [
      { markdown: "Deploy at 14:00 UTC, then tell the room.", at },
      { markdown: "No times here, just a warmed note.", at: at + 1 },
    ]
    expect(messages.map((m) => parsedFor(parseKey(m.markdown, m.at)))).toEqual([undefined, undefined])
    warm(messages, (m) => m)
    const done = () => messages.every((m) => parsedFor(parseKey(m.markdown, m.at)) !== undefined)
    for (let i = 0; i < 400 && !done(); i++) await Bun.sleep(5)
    expect(messages.map((m) => parsedFor(parseKey(m.markdown, m.at)) !== undefined)).toEqual([true, true])
  })

  test("the key carries the message's UTC day only when a bare time needs it, so repeated text shares one parse", () => {
    const morning = Date.UTC(2026, 10, 12, 1, 0)
    const evening = Date.UTC(2026, 10, 12, 23, 0)
    const nextDay = Date.UTC(2026, 10, 13, 1, 0)
    const plain = "Same words in many messages."
    expect([parseKey(plain, morning), parseKey(plain, nextDay), parseKey(plain)]).toEqual([plain, plain, plain])
    const full = "Shipped at 2026-11-12T14:00Z."
    expect([parseKey(full, morning), parseKey(full, nextDay)]).toEqual([full, full])
    const bare = "Deploy at 14:00 UTC."
    expect(parseKey(bare, morning)).toBe(parseKey(bare, evening))
    expect(parseKey(bare, morning)).not.toBe(parseKey(bare, nextDay))
    expect(parseKey(bare, morning)).not.toBe(bare)
    expect(parseKey("Deploy at 14:00Z.", morning)).not.toBe(parseKey("Deploy at 14:00Z.", nextDay))
  })

  test("a bare time the parser only sees after decoding an escape or dropping an entity still gets its own date", async () => {
    const one = Date.UTC(2026, 10, 12, 2, 0)
    const two = Date.UTC(2026, 10, 13, 2, 0)
    const forms = ["Call at 06\\:30Z.", "Call at 06:30\\Z.", "Call at 06:30&amp;Z.", "Call at 06&#58;30Z.", "Call at 06&colon;30 UTC.", "Call at &#48;6:30Z.", "Call at 06:30Z.", "Call at 06:30 UTC."]
    for (const text of forms) {
      expect([text, parseKey(text, one) === parseKey(text, two)]).toEqual([text, false])
      const [first, second] = [await rendered(text, one), await rendered(text, two)]
      expect([text, first.includes("kiwi-utc:2026-11-13"), second.includes("kiwi-utc:2026-11-12")]).toEqual([text, false, false])
    }
    for (const text of ["Call at 06\\:30Z.", "Call at 06:30Z.", "Call at 06:30 UTC."]) {
      expect([text, await rendered(text, one)]).toEqual([text, expect.stringContaining('href="kiwi-utc:2026-11-12T06:30:00Z"')])
      expect([text, await rendered(text, two)]).toEqual([text, expect.stringContaining('href="kiwi-utc:2026-11-13T06:30:00Z"')])
    }
  })

  test("without a message time, a bare time stays text and keeps a key apart from any dated render", async () => {
    const bare = "Call at 06:30Z."
    expect(parseKey(bare)).not.toBe(parseKey(bare, Date.UTC(2026, 10, 12)))
    expect(await rendered(bare)).not.toContain("kiwi-utc:")
    expect(await rendered(bare, Date.UTC(2026, 10, 12))).toContain('href="kiwi-utc:2026-11-12T06:30:00Z"')
  })

  test("same-day messages with a bare time render the same instant from one shared parse", async () => {
    const bare = "Standup moved to 09:30 UTC."
    const first = await rendered(bare, Date.UTC(2026, 10, 12, 2, 0))
    const later = await rendered(bare, Date.UTC(2026, 10, 12, 22, 0))
    expect(first).toContain('href="kiwi-utc:2026-11-12T09:30:00Z"')
    expect(later).toBe(first)
    expect(await rendered(bare, Date.UTC(2026, 10, 13, 2, 0))).toContain('href="kiwi-utc:2026-11-13T09:30:00Z"')
  })
})
