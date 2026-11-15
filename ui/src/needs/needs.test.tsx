import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { Channel, Person, QuestionAsk } from "~/model"
import { ActContext, AppContext, type Act, type Ctx } from "~/nav"
import { joinedQuestions, needsText } from "~/needs/needs"
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
    expect([...m.fields.keys()].every((name) => /^[0-9a-f]{24}-question-/.test(name))).toBe(true)
  })
})

describe("what the Lead settled is one line, never a card (T506)", () => {
  test("a fold line with the count and the first questions, and the list behind it", () => {
    const settled = [
      { id: "s1", by: "gentle-otter", asker: "upbeat-heron", at: NOW - 60_000, question: wrote("Hide agents that left?"), answer: wrote("B: dim") },
      { id: "s2", by: "gentle-otter", asker: "upbeat-heron", at: NOW - 120_000, question: wrote("Cap the bubble?"), answer: wrote("A: cap it") },
    ]
    const { md, m } = needsText({ ...channel([]), settled }, () => {})
    expect(read(md)).toContain("The Lead settled 2")
    expect([...m.fields.keys()].some((k) => k.endsWith("-settled"))).toBe(true)
    expect(md.split("\n").filter((l) => l.startsWith("> ### "))).toHaveLength(0)
  })

  test("with nothing settled there's no line", () => {
    expect(built([]).md).not.toContain("settled")
  })
})

describe("a second decision on a task joins the open card (T508)", () => {
  const first = ask({ id: "q1", holds: [7], text: wrote("Glass or frosted?") })
  const second = ask({ id: "q2", from: "upbeat-heron", at: NOW - 30_000, holds: [7], text: wrote("Which blur radius?") })
  const cardOf = (md: string, text: string): string => md.split(/\n(?!>)/).find((block) => block.includes(text)) ?? ""

  test("the later one renders inside the first card, with its own question and answers", () => {
    const { md, m } = built([second, first])
    expect(cardOf(md, "Glass or frosted?")).toContain("Which blur radius?")
    expect([...m.fields.keys()].filter((k) => k.includes("question-")).map((k) => k.slice(k.indexOf("question-")))).toEqual(["question-q1", "question-q2"])
    expect(joinedQuestions([first, second])).toEqual({ more: new Map([["q1", [second]]]), joined: new Set(["q2"]) })
  })

  test("your earlier answer on the task shows once, on the first question", () => {
    const done = ask({ id: "q0", holds: [7], options: [wrote("A: keep it")], answer: { text: wrote("A: keep it"), by: "jow", at: NOW - 86_400_000, shownIn: "card" } })
    expect(fields([done, first, second]).split("ask-earlier").length - 1).toBe(1)
  })

  test("decisions one asker sends on one area share a card, under one head, each saying whose it was (T505)", () => {
    const count = ask({ id: "a1", from: "lead", holds: [], area: "Tab strip", via: "upbeat-heron", text: wrote("The count after the name, or at the far right?") })
    const close = ask({ id: "a2", from: "lead", at: NOW - 30_000, holds: [], area: "tab strip", text: wrote("A close button on hover?") })
    const other = ask({ id: "a3", from: "lead", holds: [], area: "My bubble", text: wrote("Grey, or the accent wash?") })
    const elsewhere = ask({ id: "a4", from: "upbeat-heron", holds: [], area: "Tab strip", text: wrote("Pin the first tab?") })
    expect(joinedQuestions([count, close, other, elsewhere])).toEqual({ more: new Map([["a1", [close]]]), joined: new Set(["a2"]) })
    const md = built([count, close, other, elsewhere]).md
    const card = cardOf(md, "The count after the name")
    expect(card).toContain("A close button on hover?")
    expect(card).toContain("Tab strip")
    expect(card.split("### ").length - 1).toBe(1)
    expect(read(card)).toContain("From opus2-coder, sent on by the Lead.")
    expect(cardOf(md, "Grey, or the accent wash?")).not.toContain("The count")
  })

  test("another task, an irreversible one, a step or one that holds nothing keeps its own card", () => {
    const apart = [
      ask({ id: "q3", holds: [8] }),
      ask({ id: "q4", holds: [7], irreversible: true }),
      ask({ id: "q5", holds: [7], step: { why: "w", needsPerson: "n", do: ["d"] } }),
      ask({ id: "q6", holds: [] }),
    ]
    expect(joinedQuestions([first, ...apart]).joined.size).toBe(0)
    expect(cardOf(built([first, ...apart]).md, "Glass or frosted?")).not.toContain("Should @")
  })
})
