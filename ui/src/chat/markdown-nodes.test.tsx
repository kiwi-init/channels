import { describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import { renderToStaticMarkup } from "react-dom/server"
import type { ASTNode } from "react-native-enriched-markdown/lib/typescript/src/web/types"
import * as shim from "~/chat/react-native.ts"

void mock.module("react-native", () => shim)
Object.assign(globalThis, { __DEV__: false })

const { parseMarkdown } = await import("react-native-enriched-markdown/lib/module/web/parseMarkdown.js")
const { default: Markdown, safeLinks } = await import("~/chat/markdown.tsx")
const { keepParsed } = await import("~/chat/parsed.ts")
const { MarkdownNode } = await import("~/chat/markdown-node.tsx")
const { RenderNode } = await import("react-native-enriched-markdown/lib/module/web/renderers/index.js")
const { normalizeMarkdownStyle } = await import("react-native-enriched-markdown/lib/module/normalizeMarkdownStyle.web.js")
const { buildStyles } = await import("react-native-enriched-markdown/lib/module/web/styles.js")
const FLAGS = { latexMath: false, underline: false, hardSoftBreaks: true }
const quiet = () => {}

const MARKDOWN_CASES = [
  { name: "plain", source: "alpha beta gamma", text: "alpha beta gamma" },
  { name: "heading", source: "# heading", text: "heading" },
  { name: "strong", source: "**strong**", text: "strong" },
  { name: "emphasis", source: "*emphasis*", text: "emphasis" },
  { name: "strike", source: "~~strike~~", text: "strike" },
  { name: "link", source: "[link](https://example.com)", text: "link" },
  { name: "code", source: "`alpha ||beta|| gamma`", text: "alpha ||beta|| gamma" },
  { name: "fenced", source: "```text\nalpha ||beta|| gamma\n```", text: "alpha ||beta|| gamma" },
  { name: "quote", source: "> quoted", text: "quoted" },
  { name: "admonition", source: "> [!NOTE]\n> noted", text: "noted" },
  { name: "bullets", source: "- bullet\n- second", text: "bullet" },
  { name: "ordered", source: "1. numbered", text: "numbered" },
  { name: "task", source: "- [ ] unfinished\n- [x] finished", text: "unfinished" },
  { name: "breaks", source: "soft\nbreak  \nhard", text: "soft<br" },
  { name: "rule", source: "---", text: "<hr" },
  { name: "table", source: "| Header | Other |\n| --- | --- |\n| cell | value |", text: "cell" },
  { name: "image", source: "![picture](https://example.com/image.png)", text: "picture" },
  { name: "video", source: '<video src="https://example.com/video.mp4"></video>', text: '<source src="https://example.com/video.mp4"' },
  { name: "disabled extensions", source: "^super^ ==highlight== $math$", text: "^super^ ==highlight== $math$" },
  { name: "blank lines", source: "one\n\n\n\ntwo", text: "two" },
] as const

function rendered(markdown: string, ast: ASTNode): string {
  safeLinks(ast)
  keepParsed(markdown, ast)
  return renderToStaticMarkup(<Markdown markdown={markdown} onMention={quiet} onTask={quiet} onMessage={quiet} onImage={quiet} onShown={quiet} />)
}

const invented = (node: object): ASTNode => JSON.parse(JSON.stringify(node))
const kinds = (node: ASTNode): string[] => [node.type, ...(node.children ?? []).flatMap(kinds)]

describe("the installed parser's complete node inventory (#2444)", () => {
  for (const sample of MARKDOWN_CASES) {
    test(`${sample.name} retains its content through the actual app renderer`, async () => {
      expect(rendered(sample.source, await parseMarkdown(sample.source, FLAGS))).toContain(sample.text)
    })
  }

  test("known renderers retain their markup, direction, and task controls", async () => {
    const style = normalizeMarkdownStyle({})
    const styles = buildStyles(style)
    for (const source of [...MARKDOWN_CASES.map((sample) => sample.source), "> > مرحبا", "- [ ] first\n- [x] second"]) {
      const ast = await parseMarkdown(source, FLAGS)
      safeLinks(ast)
      for (const node of ast.children ?? []) {
        const props = { node, style, styles, callbacks: {}, capabilities: { katex: null, enableTaskListItemToggle: false, blockDir: "auto" as const } }
        expect(renderToStaticMarkup(<MarkdownNode {...props} />)).toBe(renderToStaticMarkup(<RenderNode {...props} />))
      }
    }
  })

  test("each C++/serializer type has a real fixture or an explicit reachability exclusion", async () => {
    const resolved = new URL("./", import.meta.resolve("react-native-enriched-markdown/package.json"))
    const header = readFileSync(new URL("cpp/parser/MarkdownASTNode.hpp", resolved), "utf8")
    const sourceTypes =
      header
        .split("enum class NodeType {")[1]
        ?.split("};")[0]
        ?.match(/[A-Za-z]+/g) ?? []
    const serializer = readFileSync(new URL("cpp/wasm/ASTSerializer.cpp", resolved), "utf8")
    const emitted = new Set<string>()
    for (const source of [...MARKDOWN_CASES.map((c) => c.source), "alpha ||beta|| gamma"]) {
      for (const kind of kinds(await parseMarkdown(source, FLAGS))) emitted.add(kind)
    }
    const excluded = ["Underline", "LatexMathInline", "LatexMathDisplay", "Superscript", "Subscript", "Highlight", "SoftBreak", "BlankLine"]
    expect(sourceTypes).toHaveLength(34)
    expect(emitted.size).toBe(26)
    expect(sourceTypes.filter((type) => !emitted.has(type))).toEqual(expect.arrayContaining(excluded))
    expect([...emitted, ...excluded].sort()).toEqual(sourceTypes.toSorted())
    for (const kind of sourceTypes) expect(serializer).toContain(`return "${kind}";`)
  })
})

describe("spoilers remain accessible through a reveal control", () => {
  for (const source of ["alpha ||beta|| gamma", "||one|| and ||two||", "||bold **inside** and [link](https://example.com)||", "[before ||inside|| after](https://example.com)", "- ||listed||"]) {
    test(source, async () => {
      const ast = await parseMarkdown(source, FLAGS)
      expect(kinds(ast)).toContain("Spoiler")
      const html = rendered(source, ast)
      expect(html).toContain('aria-label="Show spoiler"')
      expect(html).toContain('aria-expanded="false"')
      expect(html).not.toMatch(/<a[^>]*>(?:(?!<\/a>)[\s\S])*<button/)
      expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/)
    })
  }

  test("identical spoiler delimiters alternate rather than nesting", async () => {
    const ast = await parseMarkdown("||outer ||inner|| outer||", FLAGS)
    expect(kinds(ast).filter((k) => k === "Spoiler")).toHaveLength(2)
    expect(ast.children?.[0]?.children?.map((n) => n.type)).toEqual(["Spoiler", "Text", "Spoiler"])
  })
})

describe("future nodes keep escaped content and descendants at every depth", () => {
  const future = invented({
    type: "FutureContainer",
    content: "<future>",
    children: [
      { type: "FutureLeaf", content: "leaf" },
      { type: "Strong", children: [{ type: "Text", content: "kept" }] },
      { type: "Link", attributes: { url: "javascript:alert(1)" }, children: [{ type: "Text", content: "safe" }] },
    ],
  })
  const parents = [
    { type: "Paragraph", children: [future] },
    { type: "UnorderedList", children: [{ type: "ListItem", children: [{ type: "Paragraph", children: [future] }] }] },
    { type: "Paragraph", children: [{ type: "Link", attributes: { url: "https://example.com" }, children: [future] }] },
    {
      type: "Table",
      children: [
        { type: "TableHead", children: [{ type: "TableRow", children: [{ type: "TableHeaderCell", children: [future] }] }] },
        { type: "TableBody", children: [{ type: "TableRow", children: [{ type: "TableCell", children: [future] }] }] },
      ],
    },
  ]
  for (const parent of parents) {
    test(parent.type, () => {
      const html = rendered(`future-${parent.type}`, invented({ type: "Document", children: [parent] }))
      expect(html).toContain("&lt;future&gt;leaf<strong")
      expect(html).toContain(">kept</strong>")
      expect(html).toContain("safe")
      expect(html).not.toContain("javascript:")
      expect(html).not.toContain("<future>")
    })
    test(`${parent.type} also preserves a direct future leaf`, () => {
      const replace = (node: ASTNode): ASTNode =>
        node.type.toString() === "FutureContainer" ? invented({ type: "FutureLeaf", content: "<leaf>" }) : { ...node, ...(node.children ? { children: node.children.map(replace) } : {}) }
      const html = rendered(`future-leaf-${parent.type}`, replace(invented({ type: "Document", children: [parent] })))
      expect(html).toContain("&lt;leaf&gt;")
      expect(html).not.toContain("<leaf>")
    })
  }

  test("a spoiler in a table header or body has no nested controls or leaked label", () => {
    const ast = invented({
      type: "Document",
      children: [
        {
          type: "Table",
          children: [
            { type: "TableHead", children: [{ type: "TableRow", children: [{ type: "TableHeaderCell", children: [{ type: "Spoiler", children: [{ type: "Text", content: "hidden header" }] }] }] }] },
            { type: "TableBody", children: [{ type: "TableRow", children: [{ type: "TableCell", children: [{ type: "Spoiler", children: [{ type: "Text", content: "hidden cell" }] }] }] }] },
          ],
        },
      ],
    })
    const html = rendered("synthetic-table-spoilers", ast)
    expect(html.match(/aria-label="Show spoiler"/g)).toHaveLength(2)
    expect(html).not.toContain("hidden header")
    expect(html).not.toContain("hidden cell")
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/)
  })
})
