import { describe, expect, mock, test } from "bun:test"
import { Fragment } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import * as shim from "~/chat/react-native"
import type { Task } from "~/model"

void mock.module("react-native", () => shim)
Object.assign(globalThis, { __DEV__: false })

const { parseMarkdown } = await import("react-native-enriched-markdown/lib/module/web/parseMarkdown.js")
const { NOTHING, pieces } = await import("~/panes/engine")

type Node = { type: string; content?: string; children?: Node[] }
const textOf = (node: Node): string => node.content ?? (node.children ?? []).map(textOf).join("")

const task = (id: number, status: Task["status"]): Task =>
  ({ id, title: [], status, createdBy: "jow", createdAt: 0, updatedAt: 0, notes: [], rounds: [], history: [], archived: false }) as unknown as Task

const drawn = async (md: string, on?: (url: string) => boolean): Promise<string> => {
  const doc = (await parseMarkdown(md, { latexMath: false, underline: false, hardSoftBreaks: true })) as Node
  const all = doc.children ?? []
  const draw = pieces({ ...NOTHING, task: (id) => task(id, id === 2 ? "waiting" : "doing"), on })
  const tools = { press: () => {}, inline: (n: Node) => textOf(n), block: (n: Node) => textOf(n) }
  return renderToStaticMarkup(
    <>
      {all.map((node, i) => (
        <Fragment key={i}>{draw(node as never, i, all as never, tools as never) ?? null}</Fragment>
      ))}
    </>
  )
}

describe("page rows: a second line, a fold and the open row (T4532)", () => {
  test("a line break puts the rest of a row on its own line, under the name", async () => {
    const html = await drawn("- [Ship it](kiwi-task:1)\\\n  T1 · 9m `kiwi:n:2`")
    expect(html).toContain('class="pg-row is-two"')
    expect(html).toMatch(/<span class="pg-line num">.*T1 · 9m.*class="count is-loud"/)
    expect(html).toContain('<span class="sr">')
  })

  test("a row marked kiwi:fold hides its nested rows behind a toggle, kiwi:open shows them", async () => {
    const shut = await drawn("- [A spec](kiwi-page:spec:9) · 0/1 tasks `kiwi:fold`\n  - [Ship it](kiwi-task:1)")
    expect(shut).toContain('aria-expanded="false"')
    expect(shut).not.toContain("kiwi-task:1")
    const open = await drawn("- [A spec](kiwi-page:spec:9) · 0/1 tasks `kiwi:open`\n  - [Ship it](kiwi-task:1)")
    expect(open).toContain('aria-expanded="true"')
    expect(open).toContain('aria-label="0/1 tasks · A spec"')
    expect(open).toContain("kiwi-task:1")
    expect(open).not.toContain("kiwi:open")
  })

  test("the page's open row is marked for the eye and for screen readers", async () => {
    const html = await drawn("- [One](kiwi-task:1)\n- [Two](kiwi-task:2)", (url) => url === "kiwi-task:2")
    expect(html.match(/is-on/g)?.length).toBe(1)
    expect(html).toMatch(/aria-current="true"[^>]*>.*Two/)
  })

  test("a heading's tone and count draw as such", async () => {
    const html = await drawn("## [Needs you](kiwi-do:?tone=decide) · 2")
    expect(html).toContain('<span class="tone-decide">Needs you</span>')
    expect(html).toContain('<span class="pg-n num">2</span>')
  })
})
