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
const { default: Markdown, withTextSize, safeLinks, sortedRows } = await import("~/chat/markdown")
const { keepParsed } = await import("~/chat/parsed")

const fixed = (name: string, s: CSSProperties): string[] => [
  ...(typeof s.fontSize === "number" ? [`${name} fontSize ${s.fontSize}`] : []),
  ...(typeof s.lineHeight === "string" && s.lineHeight.endsWith("px") ? [`${name} lineHeight ${s.lineHeight}`] : []),
]

describe("message text follows Settings > Appearance > Text size", () => {
  test("every markdown style that sets a size scales with --text-scale", () => {
    const styles = withTextSize(buildStyles(normalizeMarkdownStyle({ paragraph: { fontSize: 15, lineHeight: 22 } })))
    const left = Object.entries(styles).flatMap(([name, s]) => ("left" in s ? Object.entries(s).flatMap(([align, cell]) => fixed(`${name}.${align}`, cell)) : fixed(name, s)))
    expect(left).toEqual([])
    expect(styles.paragraph).toMatchObject({ fontSize: "calc(15px * var(--text-scale, 1))", lineHeight: "calc(22px * var(--text-scale, 1))" })
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
    const ast = await parseMarkdown("Done:\n- tests\nNext: shots", { latexMath: false, underline: false, hardSoftBreaks: true })
    const html = renderToStaticMarkup(
      createElement(RenderNode, {
        node: ast.children?.[1] ?? ast,
        style: normalizeMarkdownStyle({}),
        styles: buildStyles(normalizeMarkdownStyle({})),
        callbacks: {},
        capabilities: { katex: null, enableTaskListItemToggle: false },
      })
    )
    expect(html).toMatch(/tests<br\/?>Next: shots/)
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

async function rendered(markdown: string): Promise<string> {
  const ast = await parseMarkdown(markdown, FLAGS)
  safeLinks(ast)
  keepParsed(markdown, ast)
  return renderToStaticMarkup(createElement(Markdown, { markdown, onMention: quiet, onTask: quiet, onMessage: quiet, onImage: quiet, onShown: quiet, copied: quiet }))
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

  test("a remote picture, inline, by reference or in a table, is a link that says where it opens", async () => {
    const html = await rendered("![a *b*](https://evil.example/a.png)\n\n![r][ref]\n\n| x |\n| - |\n| ![t](https://evil.example/t.png) |\n\n[ref]: https://evil.example/ref.png")
    expect(html).not.toContain("<img")
    expect(html).not.toContain('rel="preload"')
    expect(html).toContain('href="https://evil.example/a.png"')
    expect(html).toContain(">a b (opens evil.example)</a>")
    expect(html).toContain(">r (opens evil.example)</a>")
    expect(html).toContain(">t (opens evil.example)</a>")
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
