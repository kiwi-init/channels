import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { GlyphIcon, type Glyph } from "~/kit/icons"
import { LOGOS } from "~/kit/logos"
import { harnessOf } from "~/live/map"
import { slimIcon } from "~/kit/slim-icons"

const ASSETS = join(import.meta.dir, "../../../assets/harness")

const ruleOf = (tag: string, inherited: string) => / fill-rule="(\w+)"/.exec(tag)?.[1] ?? inherited

const assetPaths = (file: string) => {
  const svg = readFileSync(join(ASSETS, file), "utf8")
  const inherited = ruleOf(/<svg[^>]*>/.exec(svg)?.[0] ?? "", "nonzero")
  return [...svg.matchAll(/<path[^>]*>/g)].map(([tag]) => {
    const transform = / transform="([^"]*)"/.exec(tag)?.[1]
    const opacity = / opacity="([^"]*)"/.exec(tag)?.[1]
    return { d: / d="([^"]*)"/.exec(tag)?.[1], rule: ruleOf(tag, inherited), ...(transform ? { transform } : {}), ...(opacity ? { opacity: Number(opacity) } : {}) }
  })
}

describe("each harness an agent runs shows its own mark", () => {
  const files = readdirSync(ASSETS).filter((f) => f.endsWith(".svg"))

  test("every harness with a logo in assets/harness has one in the app, not a letter", () => {
    expect(files.length).toBeGreaterThan(9)
    for (const file of files) {
      const harness = harnessOf(file.replace(/\.svg$/, ""))
      expect([file, harness !== undefined && harness !== "other" && !!LOGOS[harness]]).toEqual([file, true])
    }
  })

  test("the marks are the shapes in assets/harness, drawn in one color", () => {
    for (const file of files.filter((f) => f !== "claude-code.svg" && f !== "codex.svg")) {
      const harness = harnessOf(file.replace(/\.svg$/, ""))
      expect([file, harness ? LOGOS[harness] : undefined]).toEqual([file, assetPaths(file)])
    }
  })

  test("a card's harness keeps its identity, whichever name the card uses", () => {
    expect(harnessOf("kimi")).toBe("kimi")
    expect(harnessOf("kimi-code")).toBe("kimi")
    expect(harnessOf("mimo")).toBe("mimo")
    expect(harnessOf("grokbot")).toBe("grok-bot")
    expect(harnessOf("zcode")).toBe("zcode")
    expect(harnessOf("something-new")).toBe("other")
    expect(harnessOf(undefined)).toBeUndefined()
  })
})

test("an icon draws the same after the build drops its round-stroke attributes", () => {
  const dir = dirname(Bun.resolveSync("@hugeicons/core-free-icons", import.meta.dir))
  const glyphOf = (code: string) => new Function(code.replace(/^export .*$/m, "").replace(/^const \w+ = /m, "return "))() as Glyph
  const drawn = (code: string) => renderToStaticMarkup(createElement(GlyphIcon, { glyph: glyphOf(code) }))
  let slimmed = 0
  for (const file of readdirSync(dir).filter((f) => f.endsWith("Icon.js"))) {
    const code = readFileSync(join(dir, file), "utf8")
    const slim = slimIcon(code)
    if (slim.length < code.length) slimmed++
    expect([file, drawn(slim)]).toEqual([file, drawn(code)])
  }
  expect(slimmed).toBeGreaterThan(1000)
})
