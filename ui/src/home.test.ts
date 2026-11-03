import { describe, expect, test } from "bun:test"
import { homeOf } from "~/home"
import type { Ask, Channel, Person, Spec, Task } from "~/model"

const agent = (name: string, more: Partial<Person> = {}): Person => ({ name, kind: "agent", owner: false, you: false, presence: "online", lastSeen: 0, joined: 0, messages: 0, ...more })

const task = (id: number, title: string): Task => ({ id, title, status: "review", createdBy: "jow", createdAt: 0, updatedAt: 0, notes: [], rounds: [], archived: false })

const spec = (ask: number, title: string, v: number): Spec => ({
  ask,
  title,
  words: "",
  by: "jow",
  at: 0,
  text: "",
  v,
  edited: { by: "lead", at: 0 },
  edits: 0,
  editors: [],
  stage: "draft",
  backs: [],
  tasks: [],
})

const channel = (more: Partial<Channel>): Channel => ({
  code: "c",
  title: "channels",
  youOwn: true,
  you: "jow",
  repos: [],
  rooms: [],
  directs: [],
  theirs: [],
  people: [],
  nicknames: new Map(),
  messages: [],
  tasks: [],
  asks: [],
  connection: "live",
  ...more,
})

const question = (id: string, at: number, more: Partial<Extract<Ask, { kind: "question" }>> = {}): Ask => ({
  kind: "question",
  id,
  from: "owl",
  at,
  text: `question ${id}`,
  label: "Decision",
  options: ["A", "B"],
  holds: [],
  ...more,
})

describe("homeOf", () => {
  test("names the lead by nickname and counts only working agents", () => {
    const h = homeOf(
      channel({
        lead: "owl",
        nicknames: new Map([["owl", "lead"]]),
        people: [
          agent("owl", { activity: { state: "working" } }),
          agent("mole", { activity: { state: "working" }, presence: "offline" }),
          agent("lemur"),
          agent("gone", { activity: { state: "working" }, left: true }),
        ],
      })
    )
    expect(h.lead).toBe("owl")
    expect(h.leadName).toBe("lead")
    expect(h.working).toBe(1)
  })

  test("lists open asks oldest first and drops answered and idle ones", () => {
    const h = homeOf(
      channel({
        asks: [question("2", 20), question("1", 10), question("3", 5, { answer: { text: "A", by: "jow", at: 30 } }), question("4", 1, { idle: true })],
      })
    )
    expect(h.asks.map((a) => a.id)).toEqual(["1", "2"])
    expect(h.asks[0]?.act).toEqual({ kind: "options", options: ["A", "B"] })
  })

  test("sends irreversible, stepped and long-choice questions to the channel instead of answering them here", () => {
    const h = homeOf(
      channel({
        asks: [question("1", 1, { irreversible: true }), question("2", 2, { options: ["a", "b", "c", "d", "e"] }), question("3", 3, { options: [] })],
      })
    )
    expect(h.asks.map((a) => a.act.kind)).toEqual(["open", "open", "open"])
  })

  test("approves a spec at its version and a review by its task", () => {
    const h = homeOf(
      channel({
        specs: [spec(55, "Home steers every channel", 90)],
        tasks: [task(94, "Home: one command bar")],
        asks: [
          { kind: "spec", id: "s55", at: 1, ask: 55, why: "approve" },
          { kind: "review", id: "r94", at: 2, from: "mole", task: 94 },
          { kind: "spec", id: "s56", at: 3, ask: 56, why: "result" },
        ],
      })
    )
    expect(h.asks.map((a) => a.text)).toEqual(["Approve spec #55 “Home steers every channel”", "Review T94 Home: one command bar", "Spec #56 is done: check it"])
    expect(h.asks.map((a) => a.act)).toEqual([{ kind: "approve-spec", ask: 55, v: 90 }, { kind: "approve-task", task: 94 }, { kind: "open" }])
  })

  test("says who wants to run what, and allows only what may be allowed", () => {
    const perm = (id: string, canAllow: boolean): Ask => ({
      kind: "permission",
      id,
      from: "win",
      at: 1,
      canAllow,
      canDeny: true,
      tool: "Bash",
      title: "wants to run a command",
      code: "bun test",
      notes: [],
    })
    const h = homeOf(channel({ asks: [perm("p1", true), perm("p2", false)] }))
    expect(h.asks.map((a) => a.text)).toEqual(["win wants to run a command: bun test", "win wants to run a command: bun test"])
    expect(h.asks.map((a) => a.act.kind)).toEqual(["allow", "open"])
  })

  test("never lets someone in from Home", () => {
    const h = homeOf(channel({ asks: [{ kind: "join", id: "j1", at: 1, name: "pero", who: "agent", code: "123-456" }] }))
    expect(h.asks[0]).toEqual({ id: "j1", at: 1, text: "pero wants to join", act: { kind: "open" } })
  })
})
