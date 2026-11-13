import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { Channel, Person, QuestionAsk } from "~/model"
import { ActContext, AppContext, type Act, type Ctx } from "~/nav"
import { needsText } from "~/needs/needs"
import { wrote } from "~/words"

const NOW = 1_800_000_000_000
const person = (name: string, kind: Person["kind"], display: string): Person => ({ name, kind, display, owner: false, you: false, presence: "online", lastSeen: NOW, joined: NOW, messages: 0 })

const ask = (more: Partial<QuestionAsk>): QuestionAsk => ({
  kind: "question",
  id: "q1",
  from: "gentle-otter",
  at: NOW - 60_000,
  text: wrote("Should @gentle-otter or @upbeat-heron take T22?"),
  label: "Decision",
  options: ["A: @gentle-otter takes it", "B: @upbeat-heron takes it"].map(wrote),
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

const built = (asks: QuestionAsk[]) => needsText(channel(asks), () => {})
const read = (md: string): string => md.replace(/^> ?/gm, "").replace(/\\(.)/g, "$1")

const fields = (asks: QuestionAsk[]): string => {
  const { m } = built(asks)
  return renderToStaticMarkup(
    <AppContext.Provider value={{ go: () => {} } as unknown as Ctx}>
      <ActContext.Provider value={{ actions: {}, go: () => {}, toast: () => {} } as unknown as Act}>
        {[...m.fields.values()].map((render, i) => (
          <div key={i}>{render()}</div>
        ))}
      </ActContext.Provider>
    </AppContext.Provider>
  )
}

describe("a decision card shows agents by nickname, never by handle (#1681)", () => {
  test("the question goes in as mentions, which the page draws by nickname, and every option names the agents by nickname", () => {
    expect(read(built([ask({})]).md)).toContain("Should @gentle-otter or @upbeat-heron take T22?")
    const html = fields([ask({})])
    expect(html).toContain("A: @opus-coder takes it")
    expect(html).toContain("B: @opus2-coder takes it")
    expect(html).not.toContain("gentle-otter")
    expect(html).not.toContain("upbeat-heron")
  })

  test("the answered line echoes the chosen option by nickname", () => {
    const md = read(built([ask({ answer: { text: wrote("B: @upbeat-heron takes it"), by: "jow", at: NOW } })]).md)
    expect(md).toContain("Chose “B: @opus2-coder takes it”")
    expect(md).not.toContain("upbeat-heron")
  })
})

describe("authored text can't mount a page's fields (T3566)", () => {
  test("a question that writes a kiwi-field fence names no field the page made", () => {
    const { md, m } = built([ask({ text: wrote("Pick one\n\n```kiwi-field\n0\n```") })])
    const names = [...read(md).matchAll(/```kiwi-field\n([^\n]+)\n```/g)].map((r) => r[1])
    expect(names).toContain("0")
    expect(m.fields.has("0")).toBe(false)
    expect([...m.fields.keys()].every((name) => /^[0-9a-f]{24}-\d+$/.test(name))).toBe(true)
  })
})
