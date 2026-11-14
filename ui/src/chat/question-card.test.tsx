import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { earlierAnswer } from "~/chat/earlier"
import QuestionCard from "~/chat/question-card"
import type { Channel, Person, QuestionAsk } from "~/model"
import { ActContext, AppContext, type Act, type Ctx } from "~/nav"
import { wrote } from "~/words"

const NOW = 1_800_000_000_000
const person = (name: string, display: string): Person => ({ name, kind: "agent", display, owner: false, you: false, presence: "online", lastSeen: NOW, joined: NOW, messages: 0 })

const channel = {
  code: "c",
  title: "c",
  youOwn: true,
  you: "jow",
  repos: [],
  rooms: [],
  directs: [],
  theirs: [],
  people: [person("gentle-otter", "opus-coder")],
  nicknames: new Map([["gentle-otter", "opus-coder"]]),
  messages: [],
  tasks: [],
  asks: [],
  connection: "live",
} as unknown as Channel

const REPLY = "> Test the build on your KDE panel\n\nWorks here, thanks @gentle-otter"

const step = (answer: QuestionAsk["answer"]): QuestionAsk => ({
  kind: "question",
  id: "40",
  from: "gentle-otter",
  at: NOW,
  text: wrote("Test the build on your KDE panel"),
  label: "A step for you",
  options: [],
  holds: [],
  step: { why: "CI has no panel", needsPerson: "eyes on a real panel", do: ["Start the AppImage"] },
  ...(answer ? { answer } : {}),
})

const choice = (answer: QuestionAsk["answer"]): QuestionAsk => ({
  kind: "question",
  id: "50",
  from: "gentle-otter",
  at: NOW,
  text: wrote("Deploy the release now?"),
  label: "A decision for you",
  options: [wrote("A: Deploy now"), wrote("B: Not yet")],
  holds: [],
  ...(answer ? { answer } : {}),
})

const render = (ask: QuestionAsk, ch: Channel = channel): string =>
  renderToStaticMarkup(
    <AppContext.Provider value={{ app: { channel: ch }, go: () => {} } as unknown as Ctx}>
      <ActContext.Provider value={{ actions: {}, go: () => {}, toast: () => {} } as unknown as Act}>
        <QuestionCard channel={ch} ask={ask} />
      </ActContext.Provider>
    </AppContext.Provider>
  )

describe("an answered step shows its answer once (#1794)", () => {
  test("answered by a reply in the room: the card says so and links to the reply, without repeating it", () => {
    const html = render(step({ text: wrote(REPLY), by: "jow", at: NOW + 60_000, shownIn: "feed", seq: 41 }))
    expect(html).toContain("You answered")
    expect(html).toContain("Show the reply")
    expect(html).not.toContain("Works here")
    expect(html).not.toContain("&gt; Test the build")
  })

  test("a room reply that matches an option shows in the feed only, not as a choice in the card", () => {
    const html = render(choice({ text: wrote("A: Deploy now"), by: "jow", at: NOW + 60_000, shownIn: "feed", seq: 41 }))
    expect(html).toContain("You replied")
    expect(html).toContain("Show the reply")
    expect(html).not.toContain("Deploy now")
  })

  test("an option picked on the card still shows as the choice", () => {
    const html = render(choice({ text: wrote("A: Deploy now"), by: "jow", at: NOW + 60_000, shownIn: "card" }))
    expect(html).toContain("You chose <b>A: Deploy now</b>")
    expect(html).not.toContain("Show the reply")
  })

  test("answered from the card: the card shows the answer through the message renderer, with nicknames", () => {
    const html = render(step({ text: wrote(REPLY), by: "jow", at: NOW + 60_000, shownIn: "card" }))
    expect(html).toContain("You answered")
    expect(html).toContain('class="msg-text"')
    expect(html).toContain("Works here, thanks @opus-coder")
    expect(html).not.toContain("gentle-otter")
    expect(html).not.toContain("Show the reply")
  })
})

describe("an ask shows your last answer on the same work (T507)", () => {
  const open = (over: Partial<QuestionAsk> = {}): QuestionAsk => ({ ...choice(undefined), id: "90", at: NOW + 120_000, holds: [7], ...over })
  const done = (id: string, text: string, at: number, over: Partial<QuestionAsk> = {}): QuestionAsk => ({
    ...choice(undefined),
    id,
    options: [wrote("A: full name with a count"), wrote("B: icon only")],
    holds: [7],
    answer: { text: wrote(text), by: "jow", at, shownIn: "card" },
    ...over,
  })
  const withAsks = (...asks: QuestionAsk[]): Channel => ({ ...channel, asks }) as Channel

  test("the latest answer you gave on a task this ask holds, as a choice or as words", () => {
    const ch = withAsks(done("60", "A: full name with a count", NOW - 86_400_000), done("70", "B: icon only", NOW), done("80", "No, keep it", NOW - 1000, { holds: [9] }))
    expect(earlierAnswer(ch, open())).toEqual({ chose: true, text: "B: icon only", at: NOW })
    expect(earlierAnswer(withAsks(done("60", "Keep the name, drop the count", NOW)), open())).toEqual({ chose: false, text: "Keep the name, drop the count", at: NOW })
    expect(earlierAnswer(withAsks(done("60", "A: full name with a count", NOW, { holds: [], task: 7 })), open({ holds: [], task: 7 }))?.chose).toBe(true)
  })

  test("nothing from someone else, another task, a browser hand-off, or the ask itself", () => {
    const other = done("60", "A: full name with a count", NOW)
    expect(earlierAnswer(withAsks({ ...other, answer: { ...other.answer!, by: "maya" } }), open())).toBeNull()
    expect(earlierAnswer(withAsks(done("60", "A", NOW, { holds: [9] })), open())).toBeNull()
    expect(earlierAnswer(withAsks(done("60", "done", NOW, { handoff: { url: "https://x", label: "x", expiresAt: NOW } })), open())).toBeNull()
    expect(earlierAnswer(withAsks(done("90", "A", NOW)), open())).toBeNull()
    expect(earlierAnswer(withAsks(done("60", "A", NOW)), open({ holds: [] }))).toBeNull()
  })

  test("a long answer is one line, cut with an ellipsis", () => {
    const long = "Keep the channel's full name on the tab with its unread count, and move the icon to the left of the name so it lines up"
    const got = earlierAnswer(withAsks(done("60", long, NOW)), open())!
    expect(got.text.length).toBe(80)
    expect(got.text.endsWith("…")).toBe(true)
  })

  test("the open card says it above its options; an answered card doesn't", () => {
    const ch = withAsks(done("60", "A: full name with a count", NOW - 3 * 86_400_000))
    const html = render(open(), ch)
    expect(html).toContain('<p class="ask-earlier">You chose “A: full name with a count” on this before · ')
    expect(html.indexOf("ask-earlier")).toBeLessThan(html.indexOf("ask-options"))
    expect(render(open({ answer: { text: wrote("A: Deploy now"), by: "jow", at: NOW + 200_000, shownIn: "card" } }), ch)).not.toContain("ask-earlier")
    expect(render(open())).not.toContain("ask-earlier")
  })
})

describe("a reply you typed in the chat shows on the open card (T509)", () => {
  test("one quiet line says it stays open until you answer here or the asker restates it", () => {
    const html = render({ ...choice(undefined), typed: { text: wrote("A and B, A first"), by: "jow", at: NOW, seq: 51 } })
    expect(html).toContain("You replied “A and B, A first” in the chat. It stays open until you answer here or opus-coder restates it")
    expect(html).toContain("ask-options")
  })

  test("someone else's typed reply doesn't speak for you", () => {
    expect(render({ ...choice(undefined), typed: { text: wrote("B"), by: "maya", at: NOW, seq: 51 } })).not.toContain("You replied")
  })
})
