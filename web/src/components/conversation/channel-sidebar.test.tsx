import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "", robotUrl: () => "", robotFor: () => "blue", harnessUrl: () => "" }))
const { ChannelSidebar } = await import("./channel-sidebar")

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
  conversations: [{ key: "main", label: "# general", unread: 0, forMe: false }],
  current: null,
  onConversation: () => {},
})

describe("the sidebar is the navigation on a wide screen", () => {
  test("its search is a real field, holding what you typed", () => {
    const html = renderToStaticMarkup(createElement(ChannelSidebar, props("relay")))
    const input = /<input[^>]*>/.exec(html)?.[0] ?? ""
    expect(input).toContain('aria-label="Search this channel"')
    expect(input).toContain('value="relay"')
  })
  test("its Agents heading opens the Agents tab", () => {
    const html = renderToStaticMarkup(createElement(ChannelSidebar, props(null)))
    expect(html).toMatch(/<section aria-label="Agents"[^>]*><h2[^>]*><button type="button"[^>]*>Agents<\/button>/)
  })
})
