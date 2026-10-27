import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import type { Tab } from "@/lib/views"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "", robotUrl: () => "", robotFor: () => "blue", harnessUrl: () => "" }))
const { Header, Toolbar, ViewsNav } = await import("./header")
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

const html = (over: Partial<typeof props> = {}) => renderToStaticMarkup(createElement(Ctx.Provider, { value: controls }, createElement(Toolbar, { ...props, ...over })))
const header = (over: Partial<typeof props> = {}) => renderToStaticMarkup(createElement(Ctx.Provider, { value: controls }, createElement(Header, { ...props, ...over })))
const toolbar = (markup: string) => /^<div role="toolbar" aria-label="kiwi"[^>]*>(.*)<\/div>$/.exec(markup)?.[1] ?? ""
const board = (over: Partial<typeof props> = {}) => renderToStaticMarkup(createElement(ViewsNav, { ...props, ...over }))
const nav = (markup: string) => /<nav aria-label="Views"[^>]*>(.*?)<\/nav>/.exec(markup)?.[1] ?? ""
const views = (markup: string) => [...nav(markup).matchAll(/<button[^>]*>([^<]+)/g)].map(([, label]) => label)

describe("on a wide screen the toolbar sits on the shell, above the card", () => {
  test("Search, Tasks and Agents sit in its centre with their labels, and no pill names the channel", () => {
    const bar = toolbar(html())
    const sections = /<nav aria-label="Sections"[^>]*>(.*?)<\/nav>/.exec(bar)?.[1] ?? ""
    expect([...sections.matchAll(/<\/svg>([A-Za-z]+)/g)].map(([, label]) => label)).toEqual(["Search", "Tasks", "Agents"])
    expect(bar).not.toContain('aria-label="kiwi, open details"')
    expect(bar).not.toContain("2 merged today")
  })
  test("Tasks wears a dot only while something needs you", () => {
    const busy = toolbar(html())
    expect(busy).toContain('aria-label="Tasks, 4 need you"')
    expect(busy).toContain('class="size-1.5 rounded-full bg-alert"')
    const calm = toolbar(html({ needs: 0 }))
    expect(calm).toContain('aria-label="Tasks"')
    expect(calm).not.toContain("bg-alert")
  })
  test("the open section is the one pressed", () => {
    const bar = toolbar(html({ tab: "agents" }))
    expect(bar.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(bar).toMatch(/aria-pressed="true"[^>]*>(?:(?!<\/button>).)*Agents<\/button>/)
  })
})

describe("with Tasks open, the task views sit at the top of the board, not in the toolbar", () => {
  test("Everything, Needs you, Working and Done", () => {
    expect(views(board())).toEqual(["Everything", "Needs you", "Working", "Done"])
    expect(nav(html({ tab: "tasks" }))).toBe("")
  })
  test("In review shows, between Working and Done, only while a task has a reviewer", () => {
    expect(views(board({ reviewing: true }))).toEqual(["Everything", "Needs you", "Working", "In review", "Done"])
  })
  test("the chosen view is the current page, and each view but Everything carries its count", () => {
    const views = nav(board({ view: "needs" }))
    expect(views.match(/aria-current="page"/g)).toHaveLength(1)
    expect(views).toMatch(/aria-current="page"[^>]*>Needs you<span[^>]*>4<\/span>/)
    expect(views).toMatch(/>Everything<\/button>/)
  })
})

describe("inside the card, the header keeps only the phone's row, search and the hold banner", () => {
  test("the wide toolbar's pill and icons are not in it", () => {
    const markup = header()
    expect(markup).not.toContain('role="toolbar"')
    expect(markup).not.toContain('aria-label="Agents"')
    expect(markup).toMatch(/^<header[^>]*><div class="drag relative flex h-\(--chrome-h\)[^"]*md:hidden">/)
  })
  test("search opens a step below the card's top edge", () => {
    expect(header({ search: "" })).toMatch(/<div class="relative mx-auto w-full max-w-\[792px\][^"]*md:pt-\(--step\)"><div role="search"/)
  })
})
