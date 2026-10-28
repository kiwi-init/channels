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
const { withTextSize } = await import("~/chat/markdown")

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
    expect(css).toContain(".md .enrm-admonition > div:first-child > span {\n  font-size: calc(15px * var(--text-scale, 1));\n}")
  })
})
