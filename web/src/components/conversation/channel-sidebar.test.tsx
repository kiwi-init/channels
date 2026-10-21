import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "", robotUrl: () => "", robotFor: () => "blue", harnessUrl: () => "" }))
const { ChannelSidebar, hiddenConversations } = await import("./channel-sidebar")

const general = { key: "main", label: "# general", unread: 0, forMe: false, withMe: true }
const mine = { key: "dm:me:win", label: "win", unread: 1, forMe: false, withMe: true }
const between = { key: "dm:atlas:win", label: "atlas & win", unread: 2, forMe: false, withMe: false }
const asking = { key: "dm:atlas:bolt", label: "atlas & bolt", unread: 1, forMe: true, withMe: false }
const quiet = { key: "dm:bolt:win", label: "bolt & win", unread: 3, forMe: false, withMe: false }

const props = (search: string | null) => ({
  title: "kiwi",
  icon: null,
  people: "2 agents · 1 person",
  onTitle: () => {},
  search,
  onSearch: () => {},
  onAgents: () => {},
  view: null,
  counts: { everything: 3, needs: 3, doing: 1, review: 1, done: 0 },
  onView: () => {},
  agents: [{ name: "win", label: "win", color: null, here: null, lead: false, load: { level: "free" as const, current: [], queued: [], waiting: [] } }],
  onMessage: () => {},
  onOpenTask: () => {},
  conversations: [general],
  current: null,
  onConversation: () => {},
})

const html = (over: Partial<ReturnType<typeof props>> = {}) => renderToStaticMarkup(createElement(ChannelSidebar, { ...props(null), ...over }))
const views = (markup: string) => /<nav aria-label="Views"[^>]*>(.*?)<\/nav>/.exec(markup)?.[1] ?? ""
const conversations = (markup: string) => /<section aria-label="Conversations"[^>]*>(.*?)<\/section>/.exec(markup)?.[1] ?? ""

describe("the sidebar is the navigation on a wide screen", () => {
  test("Search is a row until it's opened, then a real field holding what you typed", () => {
    const closed = views(html())
    expect(closed).toMatch(/<button type="button"[^>]*>.*Search<\/button>/)
    expect(closed).not.toContain("<input")
    const input = /<input[^>]*>/.exec(views(renderToStaticMarkup(createElement(ChannelSidebar, props("relay")))))?.[0] ?? ""
    expect(input).toContain('aria-label="Search this channel"')
    expect(input).toContain('value="relay"')
  })
  test("its Agents heading opens the Agents tab", () => {
    expect(html()).toMatch(/<section aria-label="Agents"[^>]*><h2[^>]*><button type="button"[^>]*>Agents<\/button>/)
  })
  test("the owner's desktop app gets New agent on the Agents heading, shown even before any agent joins", () => {
    const none = { ...props(null), agents: [] }
    expect(renderToStaticMarkup(createElement(ChannelSidebar, none))).not.toContain('aria-label="Agents"')
    const markup = renderToStaticMarkup(createElement(ChannelSidebar, { ...none, onNewAgent: () => {} }))
    expect(markup).toMatch(/<section aria-label="Agents"[^>]*><h2[^>]*>.*<button type="button" aria-label="New agent"/)
    expect(html()).not.toContain('aria-label="New agent"')
  })
})

describe("Tasks is one row with a quiet dot per state that waits", () => {
  test("the view list is gone: one Tasks row, then Needs you, In progress and In review as dots with their numbers", () => {
    const nav = views(html())
    expect(nav).toMatch(/<span class="truncate">Tasks<\/span>/)
    for (const gone of ["Everything", "Done this week"]) expect(nav).not.toContain(gone)
    const dots = [...nav.matchAll(/aria-label="([^"]+), (\d+)"[^>]*><span class="size-2 rounded-full (bg-[a-z]+)"><\/span>(\d+)</g)].map(([, label, n, color, shown]) => [label, n, color, shown])
    expect(dots).toEqual([
      ["Needs you", "3", "bg-alert", "3"],
      ["In progress", "1", "bg-doing", "1"],
      ["In review", "1", "bg-decide", "1"],
    ])
  })
  test("a state with nothing in it shows no dot", () => {
    const nav = views(html({ counts: { everything: 2, needs: 0, doing: 2, review: 0, done: 4 } }))
    expect(nav).toContain('aria-label="In progress, 2"')
    expect(nav).not.toContain("Needs you")
    expect(nav).not.toContain("In review")
  })
  test("the row is lit on any task view; Tasks is the current page on Everything, a dot on its own view", () => {
    expect(views(html())).not.toContain("prism-lit")
    const everything = views(html({ view: "everything" }))
    expect(everything).toMatch(/<li class="[^"]*prism-lit[^"]*"><button type="button" aria-current="page"/)
    const needs = views(html({ view: "needs" }))
    expect(needs).toContain("prism-lit")
    expect(needs.match(/aria-current="page"/g)).toHaveLength(1)
    expect(needs).toMatch(/aria-label="Needs you, 3" aria-current="page"/)
  })
})

describe("Conversations keep #general and your own threads; threads between agents fold away", () => {
  test("rooms, threads with you, threads asking for you and the open one stay; the rest hide", () => {
    const all = [general, mine, between, asking, quiet]
    expect(hiddenConversations(all, null)).toEqual([between, quiet])
    expect(hiddenConversations(all, between.key)).toEqual([quiet])
    expect(hiddenConversations([general, mine], null)).toEqual([])
  })
  test("folded, the list ends in an 'N more' row carrying the hidden unread total", () => {
    const list = conversations(html({ conversations: [general, mine, between, asking, quiet] }))
    const labels = [...list.matchAll(/<span class="min-w-0 flex-1 truncate">([^<]+)<\/span>/g)].map(([, l]) => l)
    expect(labels).toEqual(["# general", "win", "atlas &amp; bolt", "2 more"])
    expect(list).toMatch(/aria-expanded="false" aria-label="2 more conversations, 5 unread"/)
    expect(list).toMatch(/2 more<\/span><span class="[^"]*">5<\/span>/)
  })
  test("with nothing to fold there's no more row", () => {
    const list = conversations(html({ conversations: [general, mine] }))
    expect(list).not.toContain("aria-expanded")
    expect(list).not.toContain("more")
  })
  test("the open thread stays even between agents, and stays lit", () => {
    const list = conversations(html({ conversations: [general, between, quiet], current: between.key }))
    expect(list).toMatch(/aria-current="page"[^>]*><span class="min-w-0 flex-1 truncate">atlas &amp; win<\/span>/)
    expect(list).toContain('aria-label="1 more conversation, 3 unread"')
  })
})
