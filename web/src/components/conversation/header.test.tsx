import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import type { Tab } from "@/lib/views"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "", robotUrl: () => "", robotFor: () => "blue", harnessUrl: () => "" }))
const { Header } = await import("./header")
const { Ctx } = await import("../controls/context")

const controls = { p: { state: { hold: null } } } as unknown as NonNullable<Parameters<typeof Ctx.Provider>[0]["value"]>

const props = {
  headRef: () => {},
  onBack: () => {},
  search: null,
  setSearch: () => {},
  tab: "conversation" as Tab,
  onTab: () => {},
  heading: "kiwi",
  wideHeading: "kiwi",
  headingLabel: "kiwi, open details",
  face: { icon: null, title: "kiwi" },
  status: ["2 merged today", "4 need you"],
  onTitle: () => {},
  searchHint: "Search this channel",
  places: null,
  needs: 4,
  view: "everything" as const,
  counts: { everything: 7, needs: 4, doing: 1, review: 1, done: 2 },
  onView: () => {},
  reviewing: false,
}

const html = (over: Partial<typeof props> = {}) => renderToStaticMarkup(createElement(Ctx.Provider, { value: controls }, createElement(Header, { ...props, ...over })))
const toolbar = (markup: string) => /<header[^>]*><div class="drag relative hidden[^"]*">(.*?)<\/div><div class="drag relative flex/.exec(markup)?.[1] ?? ""
const nav = (markup: string) => /<nav aria-label="Views"[^>]*>(.*?)<\/nav>/.exec(markup)?.[1] ?? ""
const views = (markup: string) => [...nav(markup).matchAll(/<button[^>]*>([^<]+)/g)].map(([, label]) => label)

describe("the card's header is one toolbar on a wide screen", () => {
  test("the channel's name and status sit in a pill that opens Details, with Search, Tasks and Agents as icons beside it", () => {
    const bar = toolbar(html())
    expect(bar).toMatch(/<button type="button" aria-label="kiwi, open details"[^>]*>.*kiwi.*2 merged today · 4 need you/)
    const icons = [...bar.matchAll(/aria-label="(Search|Tasks[^"]*|Agents)"/g)].map(([, label]) => label)
    expect(icons).toEqual(["Search", "Tasks, 4 need you", "Agents"])
  })
  test("Tasks wears a dot only while something needs you", () => {
    expect(toolbar(html())).toContain('class="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-alert"')
    const calm = toolbar(html({ needs: 0 }))
    expect(calm).toContain('aria-label="Tasks"')
    expect(calm).not.toContain("bg-alert")
  })
})

describe("with Tasks open, the task views take the pill's place", () => {
  test("Everything, Needs you, Working and Done, with no pill", () => {
    const markup = html({ tab: "tasks" })
    expect(views(markup)).toEqual(["Everything", "Needs you", "Working", "Done"])
    expect(toolbar(markup)).not.toContain('aria-label="kiwi, open details"')
  })
  test("In review shows, between Working and Done, only while a task has a reviewer", () => {
    expect(views(html({ tab: "tasks", reviewing: true }))).toEqual(["Everything", "Needs you", "Working", "In review", "Done"])
  })
  test("the chosen view is the current page, and each view but Everything carries its count", () => {
    const views = nav(html({ tab: "tasks", view: "needs" }))
    expect(views.match(/aria-current="page"/g)).toHaveLength(1)
    expect(views).toMatch(/aria-current="page"[^>]*>Needs you<span[^>]*>4<\/span>/)
    expect(views).toMatch(/>Everything<\/button>/)
  })
})
