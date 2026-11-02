import { describe, expect, test } from "bun:test"

import type { Channel, Message, Person, Spec, Task } from "~/model"
import { alarmsOf, commentsOf, lineDiff, needsYou, quoteIn, splitQuote, stageLine, storyOf } from "~/specs/read"

const NOW = 1_800_000_000_000
const person = (name: string, kind: Person["kind"] = "human"): Person => ({ name, kind, owner: false, you: false, presence: "online", lastSeen: NOW, joined: NOW, messages: 0 })
const general = { kind: "room", room: "general" } as const

const spec = (more: Partial<Spec> = {}): Spec => ({
  ask: 10,
  title: "Export the board",
  words: "board as a spreadsheet please",
  by: "maya",
  at: NOW - 60_000,
  text: "# Export the board\n\n## Done when\n- [ ] a button\n- [x] the columns line up",
  v: 11,
  edited: { by: "atlas", at: NOW - 30_000 },
  edits: 1,
  editors: ["atlas"],
  stage: "draft",
  backs: [],
  tasks: [],
  ...more,
})

const task = (more: Partial<Task> & Pick<Task, "id">): Task => ({
  title: `task ${more.id}`,
  status: "doing",
  createdBy: "atlas",
  createdAt: NOW,
  updatedAt: NOW,
  notes: [],
  rounds: [],
  history: [],
  archived: false,
  ...more,
})

const channel = (more: Partial<Channel> = {}): Channel =>
  ({
    code: "c",
    title: "c",
    youOwn: true,
    you: "jow",
    repos: [],
    rooms: [],
    directs: [],
    theirs: [],
    people: [person("jow"), person("maya"), person("atlas", "agent"), person("win", "agent")],
    nicknames: new Map(),
    messages: [],
    tasks: [],
    taskGroups: [],
    asks: [],
    connection: "live",
    ...more,
  }) as Channel

describe("a spec reads where it stands, in words a person reads", () => {
  test("a draft waits for its person; approved, it waits for an agent with its place in line", () => {
    expect(stageLine(channel(), spec({ canJudge: true }))).toEqual({ word: "draft", tone: "tone-quiet", line: "waits for your approval" })
    expect(stageLine(channel(), spec()).line).toBe("waits for maya to approve it")
    expect(stageLine(channel({ free: [] }), spec({ stage: "queued", queue: 2 })).line).toBe("starts when an agent is free · 2nd in line · none free yet")
    expect(stageLine(channel({ free: ["win"] }), spec({ stage: "queued", queue: 1 })).line).toBe("starts when an agent is free · next in line · 1 free")
    expect(stageLine(channel(), spec({ stage: "queued", planner: "win" })).line).toBe("win is planning it")
    expect(stageLine(channel(), spec({ stage: "queued", changed: true, approved: { by: "maya", at: NOW, v: 11, text: "" } })).word).toBe("changed")
  })

  test("working names who's on it and how much is done", () => {
    const c = channel({ tasks: [task({ id: 1, owner: "win" }), task({ id: 2, status: "done", owner: "atlas" }), task({ id: 3, status: "done", cancelled: true })] })
    expect(stageLine(c, spec({ stage: "working", tasks: [1, 2, 3] })).line).toBe("win · 1 of 2 tasks done")
  })

  test("it needs you when you may judge it and it's a draft, delivered or changed", () => {
    expect(needsYou(spec({ canJudge: true }))).toBe(true)
    expect(needsYou(spec())).toBe(false)
    expect(needsYou(spec({ canJudge: true, stage: "working" }))).toBe(false)
    expect(needsYou(spec({ canJudge: true, stage: "working", changed: true }))).toBe(true)
    expect(needsYou(spec({ canJudge: true, stage: "delivered" }))).toBe(true)
  })
})

describe("comments sit on the line they quote", () => {
  test("a comment's leading quote is its anchor, the rest is what it says", () => {
    expect(splitQuote("> one row per task\n> with a parent\n\nshould subtasks nest?")).toEqual({ quote: "one row per task\nwith a parent", text: "should subtasks nest?" })
    expect(splitQuote("no quote here")).toEqual({ text: "no quote here" })
  })

  test("the thread under the person's message is the spec's discussion", () => {
    const messages: Message[] = [
      { seq: 10, from: "maya", at: NOW, text: "board please", where: general },
      { seq: 12, from: "win", at: NOW, text: "> a button\n\nwhere?", where: general, inThread: 10 },
      { seq: 13, from: "atlas", at: NOW, text: "elsewhere", where: general, inThread: 99 },
      { seq: 14, from: "jow", at: NOW, text: "", where: general, inThread: 10, deleted: true },
    ]
    expect(commentsOf({ messages }, 10).map((c) => [c.m.seq, c.quote ?? null, c.text])).toEqual([[12, "a button", "where?"]])
  })

  test("a quote finds its line whatever the markdown around it", () => {
    expect(quoteIn("The Tasks view has an Export button that saves board.csv", "an **Export** button")).toBe(true)
    expect(quoteIn("Subtasks as their own rows", "subtasks as their OWN rows")).toBe(true)
    expect(quoteIn("Subtasks as their own rows", "")).toBe(false)
  })
})

describe("what changed since approval, and what happened inside", () => {
  test("a line diff keeps what stayed and marks what came and went", () => {
    expect(lineDiff("a\nb\nc", "a\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ])
    expect(lineDiff("- [ ] works\n- [ ] fast", "- [x] works\n- [ ] fast\n- [ ] small").map((l) => l.kind)).toEqual(["same", "same", "add"])
  })

  test("the glass breaks only for what needs a person: circling, red checks, a stuck task, a changed spec", () => {
    const c = channel({
      tasks: [
        task({ id: 1, rounds: [1, 2].map((n) => ({ n, by: "win", at: NOW, result: "rejected" as const })) }),
        task({ id: 2, updatedAt: NOW - 50 * 60_000 }),
        task({ id: 3, status: "review", pr: { repo: "r", number: 7, title: "t", url: "u", state: "open", checks: "fail" } }),
        task({ id: 4, status: "done", updatedAt: NOW - 90 * 60_000 }),
      ],
    })
    const kinds = alarmsOf(c, spec({ stage: "working", tasks: [1, 2, 3, 4], changed: true, approved: { by: "maya", at: NOW, v: 1, text: "" } }), NOW).map((a) => [a.kind, a.task ?? null])
    expect(kinds).toEqual([
      ["changed", null],
      ["circling", 1],
      ["stuck", 2],
      ["red", 3],
    ])
  })

  test("the story is told from what happened, in order", () => {
    const c = channel({
      tasks: [
        task({
          id: 1,
          title: "writer",
          history: [
            { seq: 1, by: "atlas", at: NOW - 20_000, what: "created" },
            { seq: 2, by: "win", at: NOW - 10_000, what: "took" },
            { seq: 3, by: "win", at: NOW - 5_000, what: "note", note: "x" },
          ],
        }),
      ],
    })
    const story = storyOf(c, spec({ stage: "working", tasks: [1], approved: { by: "maya", at: NOW - 25_000, v: 11, text: "" } })).map((s) => `${s.who} ${s.text}`)
    expect(story).toEqual(["maya asked: “board as a spreadsheet please”", "atlas wrote the spec", "maya approved the spec", "atlas filed T1 “writer”", "win took T1"])
  })
})
