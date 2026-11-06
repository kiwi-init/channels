import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

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

const render = (ask: QuestionAsk): string =>
  renderToStaticMarkup(
    <AppContext.Provider value={{ app: { channel }, go: () => {} } as unknown as Ctx}>
      <ActContext.Provider value={{ actions: {}, go: () => {}, toast: () => {} } as unknown as Act}>
        <QuestionCard channel={channel} ask={ask} />
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
