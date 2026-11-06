import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"

import { StepHow } from "~/chat/step"
import { openOutside } from "~/kit/outside"

const opener = (fail = false) => {
  const opened: string[] = []
  return {
    opened,
    via: { openExternal: async (url: string) => (fail ? Promise.reject(new Error("no browser")) : void opened.push(url)) },
  }
}

describe("links outside the app open through the desktop bridge (#1818)", () => {
  test("a web link goes to openExternal", () => {
    const { opened, via } = opener()
    openOutside("https://vercel.com/login", () => {}, via)
    expect(opened).toEqual(["https://vercel.com/login"])
  })

  test("anything but http(s) and mailto is ignored", () => {
    const { opened, via } = opener()
    openOutside("javascript:alert(1)", () => {}, via)
    openOutside("kiwi-task:7", () => {}, via)
    expect(opened).toEqual([])
  })

  test("a failed open is reported", async () => {
    const { via } = opener(true)
    let failed = false
    openOutside("https://example.com", () => (failed = true), via)
    await new Promise((done) => setTimeout(done, 0))
    expect(failed).toBe(true)
  })

  test("a step card's links don't rely on target=_blank", () => {
    const html = renderToStaticMarkup(<StepHow step={{ why: "w", needsPerson: "jow", links: ["https://example.com/doc"] }} you={["jow", "Jow"]} />)
    expect(html).toContain('href="https://example.com/doc"')
    expect(html).not.toContain('target="_blank"')
  })

  test("no component opens a link with a raw target=_blank anchor", () => {
    const src = join(import.meta.dir, "..")
    const files = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    const raw = files.filter((f) => f !== join("chat", "mermaid.tsx") && readFileSync(join(src, f), "utf8").includes('target="_blank"'))
    expect(raw).toEqual([])
  })
})
