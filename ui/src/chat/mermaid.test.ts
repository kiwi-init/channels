import { describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import * as shim from "~/chat/react-native"

void mock.module("react-native", () => shim)
Object.assign(globalThis, { __DEV__: false })

const { parseMarkdown } = await import("react-native-enriched-markdown/lib/module/web/parseMarkdown.js")
const { default: Markdown, mermaidSource } = await import("~/chat/markdown")
const { keepParsed } = await import("~/chat/parsed")
const { drawCached, errorLine, linksApart, picturesOff } = await import("~/chat/mermaid")

const FLAGS = { latexMath: false, underline: false, hardSoftBreaks: true }
const fence = "```"
const quiet = () => {}

async function rendered(markdown: string): Promise<string> {
  const ast = await parseMarkdown(markdown, FLAGS)
  keepParsed(markdown, ast)
  return renderToStaticMarkup(createElement(Markdown, { markdown, onMention: quiet, onTask: quiet, onMessage: quiet, onImage: quiet, onShown: quiet, copied: quiet }))
}

describe("a mermaid block in a message (T635)", () => {
  test("shows its code until the diagram is drawn, and other code stays a plain block", async () => {
    const html = await rendered(`${fence}mermaid\nflowchart LR\n  A --> B\n${fence}\n\n${fence}ts\nconst a = 1\n${fence}`)
    expect(html.match(/class="md-mermaid"/g)?.length).toBe(1)
    expect(html).toContain("flowchart LR")
    expect(html).toContain('aria-label="Code block: ts"')
    expect(html).not.toContain('aria-label="Mermaid diagram"')
  })

  test("is found by its language, whatever its case, and an empty one is ordinary code", async () => {
    const ast = await parseMarkdown(`${fence}Mermaid\ngraph TD; A-->B\n${fence}\n\n${fence}mermaid\n${fence}\n\n${fence}sh\nls\n${fence}`, FLAGS)
    expect((ast.children ?? []).map(mermaidSource)).toEqual(["graph TD; A-->B\n", undefined, undefined])
  })
})

describe("drawing a Mermaid diagram", () => {
  test("is done once per source and color scheme, and a remount reuses it", async () => {
    let drawn = 0
    const render = async (s: string) => (drawn++, { kind: "svg" as const, svg: `<svg>${s}</svg>` })
    const a = drawCached("graph TD; A-->B", "light-one", render)
    expect(drawCached("graph TD; A-->B", "light-one", render)).toBe(a)
    expect(await a).toEqual({ kind: "svg", svg: "<svg>graph TD; A-->B</svg>" })
    await drawCached("graph TD; A-->B", "dark-one", render)
    expect(drawn).toBe(2)
  })

  test("a source over 20,000 characters is never drawn", async () => {
    let drawn = 0
    const got = await drawCached(`graph TD;${"A-->B;".repeat(4_000)}`, "light-two", async () => (drawn++, { kind: "svg" as const, svg: "" }))
    expect(drawn).toBe(0)
    expect(got).toMatchObject({ kind: "error", message: expect.stringContaining("too long to draw") })
  })

  test("keeps at most 100 drawings, dropping the one used longest ago", async () => {
    let drawn = 0
    const render = async () => (drawn++, { kind: "svg" as const, svg: "" })
    for (let i = 0; i < 101; i++) await drawCached(`graph ${i}`, "evict", render)
    expect(drawn).toBe(101)
    await drawCached("graph 100", "evict", render)
    expect(drawn).toBe(101)
    await drawCached("graph 0", "evict", render)
    expect(drawn).toBe(102)
  })

  test("an error reads as its first line, or says it isn't valid Mermaid", () => {
    expect(errorLine(new Error("Parse error on line 2:\n...A -- B\n---^"))).toBe("Parse error on line 2")
    expect(errorLine(new Error(""))).toBe("it isn’t valid Mermaid")
  })

  test("a diagram's click links open apart from the app, whatever target the diagram asked for", () => {
    expect(linksApart('<g><a xlink:href="https://evil.example/login"><rect/></a></g>')).toBe('<g><a xlink:href="https://evil.example/login" target="_blank" rel="noopener noreferrer"><rect/></a></g>')
    expect(linksApart(`<a href="https://x.example" target="_self" rel='opener'><text>go</text></a>`)).toBe('<a href="https://x.example" target="_blank" rel="noopener noreferrer"><text>go</text></a>')
    expect(linksApart('<g><animate attributeName="x"/><text>a</text></g>')).toBe('<g><animate attributeName="x"/><text>a</text></g>')
  })

  test("a diagram's link keeps its address only when a click would open it (#1308)", () => {
    expect(linksApart('<a xlink:href="tel:123"><rect/></a>')).toBe('<a target="_blank" rel="noopener noreferrer"><rect/></a>')
    expect(linksApart("<a href='javascript:alert(1)' xlink:href=\"&#106;avascript:x\">go</a>")).toBe('<a target="_blank" rel="noopener noreferrer">go</a>')
    expect(linksApart('<a href="mailto:a@b.example?x=1&amp;y=2">m</a>')).toBe('<a href="mailto:a@b.example?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">m</a>')
  })

  test("a drawn diagram keeps no picture address but data:, and the page itself loads pictures only from its own origin (#1308)", () => {
    expect(picturesOff('<image href="https://evil.example/a.png" width="4"/><img src="/icon.svg?read=1" alt="i"><image xlink:href="data:image/png;base64,AA"/>')).toBe(
      '<image width="4"/><img alt="i"><image xlink:href="data:image/png;base64,AA"/>'
    )
    const page = readFileSync(join(import.meta.dir, "../../index.html"), "utf8")
    expect(page).toContain(
      `<meta http-equiv="Content-Security-Policy" content="img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-src 'none'" />`
    )
  })
})
