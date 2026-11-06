import { afterEach, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { isValidElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { StepHow } from "~/chat/step"
import { OutsideLink, openOutside } from "~/kit/outside"

const LINK = "https://example.com/doc"
const had = Object.getOwnPropertyDescriptor(globalThis, "window")

afterEach(() => {
  if (had) Object.defineProperty(globalThis, "window", had)
  else Reflect.deleteProperty(globalThis, "window")
})

const fakeWindow = (kiwi: object | undefined, opened: string[]) =>
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { kiwi, open: (url: string, target: string, features: string) => void opened.push(`${url} ${target} ${features}`) },
  })

function findLink(node: ReactNode, href: string): Parameters<typeof OutsideLink>[0] | undefined {
  if (Array.isArray(node)) return node.map((n) => findLink(n, href)).find(Boolean)
  if (!isValidElement<{ href?: string; children?: ReactNode }>(node)) return undefined
  const at = node.props.href
  if (node.type === OutsideLink && at === href) return { href: at, children: node.props.children }
  return findLink(node.props.children, href)
}

function clickStepLink(): { prevented: boolean } {
  const link = findLink(StepHow({ step: { why: "w", needsPerson: "jow", links: [LINK] }, you: ["jow"] }), LINK)
  if (!link) throw new Error("the step card has no OutsideLink for its link")
  const onClick: unknown = OutsideLink(link).props.onClick
  if (typeof onClick !== "function") throw new Error("the step link has no click handler")
  let prevented = false
  onClick({ preventDefault: () => (prevented = true) })
  return { prevented }
}

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

  test("clicking a step link on desktop opens it through the bridge and stops the webview's own navigation", () => {
    const opened: string[] = []
    const shown: string[] = []
    fakeWindow({ getSnapshot: () => ({}), openExternal: async (url: string) => void opened.push(url) }, shown)
    const { prevented } = clickStepLink()
    expect(opened).toEqual([LINK])
    expect(shown).toEqual([])
    expect(prevented).toBe(true)
  })

  test("in a browser, with no bridge, a step link opens a new tab", () => {
    const shown: string[] = []
    fakeWindow(undefined, shown)
    const { prevented } = clickStepLink()
    expect(shown).toEqual([`${LINK} _blank noopener,noreferrer`])
    expect(prevented).toBe(true)
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
