import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "", robotUrl: () => "", robotFor: () => "blue", harnessUrl: () => "" }))
const { Conversations, afterRooms, hiddenConversations, leftConversations } = await import("./channel-sidebar")

const general = { key: "main", label: "# general", unread: 0, forMe: false, withMe: true, left: false }
const mine = { key: "dm:me:win", label: "win", unread: 1, forMe: false, withMe: true, left: false }
const between = { key: "dm:atlas:win", label: "atlas & win", unread: 2, forMe: false, withMe: false, left: false }
const asking = { key: "dm:atlas:bolt", label: "atlas & bolt", unread: 1, forMe: true, withMe: false, left: false }
const quiet = { key: "dm:bolt:win", label: "bolt & win", unread: 3, forMe: false, withMe: false, left: false }
const gone = { key: "dm:me:oak", label: "oak", unread: 0, forMe: false, withMe: true, left: true }
const goneAsking = { key: "dm:me:elm", label: "elm", unread: 2, forMe: true, withMe: true, left: true }
const goneBetween = { key: "dm:atlas:oak", label: "atlas & oak", unread: 4, forMe: false, withMe: false, left: true }

const props = {
  conversations: [general],
  current: null as string | null,
  onConversation: () => {},
  rooms: [],
}

const html = (over: Partial<typeof props> & { onNewRoom?: (name: string) => Promise<void> } = {}) => renderToStaticMarkup(createElement(Conversations, { ...props, ...over }))
const conversations = (markup: string) => /<section aria-label="Conversations"[^>]*>(.*?)<\/section>/.exec(markup)?.[1] ?? ""

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
    expect(labels).toEqual(["general", "win", "atlas &amp; bolt", "2 more"])
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
    expect(list).toMatch(/aria-current="page"[^>]*>.*?<span class="min-w-0 flex-1 truncate">atlas &amp; win<\/span>/)
    expect(list).toContain('aria-label="1 more conversation, 3 unread"')
  })
})

describe("conversations with members who left the channel fold under Left the channel", () => {
  test("a thread whose other side left hides, with you or between others, unless it's open or unread for you", () => {
    const all = [general, mine, gone, goneAsking, goneBetween, quiet]
    expect(leftConversations(all, null)).toEqual([gone, goneBetween])
    expect(leftConversations(all, gone.key)).toEqual([goneBetween])
    expect(hiddenConversations(all, null)).toEqual([quiet])
  })
  test("the fold is one closed row with how many it holds; the left threads aren't listed and don't count in N more", () => {
    const list = conversations(html({ conversations: [general, mine, gone, goneAsking, goneBetween, quiet] }))
    const labels = [...list.matchAll(/<span class="min-w-0 flex-1 truncate">([^<]+)<\/span>/g)].map(([, l]) => l)
    expect(labels).toEqual(["general", "win", "elm", "1 more", "Left the channel"])
    expect(list).toContain('aria-label="1 more conversation, 3 unread"')
    expect(list).toMatch(/aria-expanded="false" aria-label="Left the channel, 2 conversations"/)
    expect(list).toMatch(/Left the channel<\/span><span class="[^"]*">2<\/span>/)
  })
  test("no one left, no fold", () => {
    expect(conversations(html({ conversations: [general, mine, quiet] }))).not.toContain("Left the channel")
  })
})

describe("the owner makes a room from the sidebar", () => {
  test("a New room row at the foot of the conversations, for the owner only", () => {
    expect(conversations(html())).not.toContain("New room")
    expect(conversations(html({ onNewRoom: async () => {} }))).toMatch(/<li><button type="button"[^>]*>.*<span class="min-w-0 flex-1 truncate">New room<\/span><\/button><\/li><\/ul>$/)
  })
  test("its field opens right under the rooms, before the direct conversations", () => {
    const room = (id: string) => ({ key: `room:${id}`, label: `# ${id}`, unread: 0, forMe: false, withMe: true, left: false })
    expect(afterRooms([general, mine, between])).toBe(1)
    expect(afterRooms([room("general"), room("mobile"), mine])).toBe(2)
    expect(afterRooms([mine])).toBe(0)
  })
})
