import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { Channel, Person, QuestionAsk } from "~/model"
import { ActContext, AppContext, type Act, type Ctx } from "~/nav"
import { NeedsYou } from "~/needs/needs"

const NOW = 1_800_000_000_000
const person = (name: string, kind: Person["kind"], display: string): Person => ({ name, kind, display, owner: false, you: false, presence: "online", lastSeen: NOW, joined: NOW, messages: 0 })

const ask = (more: Partial<QuestionAsk>): QuestionAsk => ({
  kind: "question",
  id: "q1",
  from: "gentle-otter",
  at: NOW - 60_000,
  text: "Should @gentle-otter or @upbeat-heron take T22?",
  label: "Decision",
  options: ["A: @gentle-otter takes it", "B: @upbeat-heron takes it"],
  holds: [],
  ...more,
})

const channel = (asks: QuestionAsk[]): Channel =>
  ({
    code: "c",
    title: "c",
    youOwn: true,
    you: "jow",
    repos: [],
    rooms: [],
    directs: [],
    theirs: [],
    people: [person("jow", "human", "Jow"), person("gentle-otter", "agent", "opus-coder"), person("upbeat-heron", "agent", "opus2-coder")],
    nicknames: new Map([
      ["jow", "Jow"],
      ["gentle-otter", "opus-coder"],
      ["upbeat-heron", "opus2-coder"],
    ]),
    messages: [],
    tasks: [],
    taskGroups: [],
    asks,
    connection: "live",
  }) as unknown as Channel

const render = (asks: QuestionAsk[]): string =>
  renderToStaticMarkup(
    <AppContext.Provider value={{ go: () => {} } as unknown as Ctx}>
      <ActContext.Provider value={{ actions: {}, go: () => {}, toast: () => {} } as unknown as Act}>
        <NeedsYou channel={channel(asks)} onJump={() => {}} />
      </ActContext.Provider>
    </AppContext.Provider>
  )

describe("a decision card shows agents by nickname, never by handle (#1681)", () => {
  test("the question and every option name the agents by nickname", () => {
    const html = render([ask({})])
    expect(html).toContain("Should @opus-coder or @opus2-coder take T22?")
    expect(html).toContain("A: @opus-coder takes it")
    expect(html).toContain("B: @opus2-coder takes it")
    expect(html).not.toContain("gentle-otter")
    expect(html).not.toContain("upbeat-heron")
  })

  test("the answered line echoes the chosen option by nickname", () => {
    const html = render([ask({ answer: { text: "B: @upbeat-heron takes it", by: "jow", at: NOW } })])
    expect(html).toContain("Chose “B: @opus2-coder takes it”")
    expect(html).not.toContain("upbeat-heron")
  })
})
