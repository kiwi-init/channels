import { describe, expect, test } from "bun:test"
import { homeOf, saidIn, takeTurns } from "~/home"
import type { Ask, Channel, Person, Spec, Task } from "~/model"
import { wrote } from "~/words"

const agent = (name: string, more: Partial<Person> = {}): Person => ({ name, kind: "agent", owner: false, you: false, presence: "online", lastSeen: 0, joined: 0, messages: 0, ...more })

const task = (id: number, title: string): Task => ({ id, title: wrote(title), status: "review", createdBy: "jow", createdAt: 0, updatedAt: 0, notes: [], rounds: [], archived: false })

const spec = (ask: number, title: string, v: number): Spec => ({
  ask,
  title: wrote(title),
  words: wrote(""),
  by: "jow",
  at: 0,
  text: wrote(""),
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
  text: wrote(`question ${id}`),
  label: "Decision",
  options: ["A", "B"].map(wrote),
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
        asks: [question("2", 20), question("1", 10), question("3", 5, { answer: { text: wrote("A"), by: "jow", at: 30 } }), question("4", 1, { idle: true })],
      })
    )
    expect(h.asks.map((a) => a.id)).toEqual(["1", "2"])
    expect(h.asks[0]?.act).toEqual({
      kind: "options",
      options: [
        { shown: "A", answer: "A" },
        { shown: "B", answer: "B" },
      ],
    })
  })

  test("an ask and its options name agents by nickname, while answering sends the option as written (#1763)", () => {
    const ask = question("1", 1, { text: wrote("Should @gentle-otter take T4?"), options: ["@gentle-otter takes it", "Not yet"].map(wrote) })
    const h = homeOf(channel({ asks: [ask], nicknames: new Map([["gentle-otter", "lead"]]) }))
    expect(h.asks[0]?.text).toBe("Should @lead take T4?")
    expect(h.asks[0]?.act).toEqual({
      kind: "options",
      options: [
        { shown: "@lead takes it", answer: "@gentle-otter takes it" },
        { shown: "Not yet", answer: "Not yet" },
      ],
    })
  })

  test("sends irreversible, stepped and long-choice questions to the channel instead of answering them here", () => {
    const h = homeOf(
      channel({
        asks: [question("1", 1, { irreversible: true }), question("2", 2, { options: ["a", "b", "c", "d", "e"].map(wrote) }), question("3", 3, { options: [] })],
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
    expect(h.asks.map((a) => a.what)).toEqual(["Approve spec #55", "Review T94", "Spec #56 is done: check it"])
    expect(h.asks.map((a) => a.text)).toEqual(["Home steers every channel", "Home: one command bar", "Spec #56"])
    expect(h.asks.map((a) => a.act)).toEqual([{ kind: "approve-spec", ask: 55, v: 90 }, { kind: "approve-task", task: 94 }, { kind: "open" }])
  })

  test("a spec to approve names agents by nickname in its title (#1763)", () => {
    const h = homeOf(
      channel({ nicknames: new Map([["gentle-otter", "lead"]]), specs: [spec(55, "Pair @gentle-otter with the relay", 1)], asks: [{ kind: "spec", id: "s55", at: 1, ask: 55, why: "approve" }] })
    )
    expect(h.asks[0]?.text).toBe("Pair @lead with the relay")
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
    expect(h.asks.map((a) => [a.what, a.text])).toEqual([
      ["win wants to run a command", "bun test"],
      ["win wants to run a command", "bun test"],
    ])
    expect(h.asks.map((a) => a.act.kind)).toEqual(["allow", "open"])
  })

  test("never lets someone in from Home", () => {
    const h = homeOf(channel({ asks: [{ kind: "join", id: "j1", at: 1, name: "pero", who: "agent", code: "123-456" }] }))
    expect(h.asks[0]).toEqual({ id: "j1", at: 1, what: "Wants to join", text: "pero", act: { kind: "open" } })
  })

  test("a long ask reads in full up to its clip, not cut at a line's width", () => {
    const long = "word ".repeat(50).trim()
    const h = homeOf(channel({ asks: [question("1", 1, { text: wrote(long) })] }))
    expect(h.asks[0]?.text).toBe(long)
  })

  test("a moving task's title names agents by nickname, not handle (#1763)", () => {
    const t: Task = { ...task(1, "Pair with @gentle-otter on the relay"), status: "doing", history: [], updatedAt: 1 }
    const h = homeOf(channel({ tasks: [t], nicknames: new Map([["gentle-otter", "lead"]]) }))
    expect(h.moving[0]?.title).toBe("Pair with @lead on the relay")
  })

  test("shows the tasks moving with who has them and where they stand, and counts the rest and today's done", () => {
    const doing = (id: number, more: Partial<Task> = {}): Task => ({ ...task(id, `task ${id}`), status: "doing", history: [], updatedAt: id, ...more })
    const h = homeOf(
      channel({
        nicknames: new Map([["fern", "Fern"]]),
        people: [agent("fern", { activity: { state: "working", tool: "Bash" } }), agent("moss")],
        tasks: [
          doing(1, { owner: "fern" }),
          doing(2, { owner: "moss", stage: "proving", pr: { repo: "r", number: 7, title: "", url: "", state: "open", checks: "running", ticks: { passed: 1, running: 2, failed: [] } } }),
          doing(3, { stage: "red", pr: { repo: "r", number: 8, title: "", url: "", state: "open", checks: "fail", ticks: { passed: 1, running: 0, failed: ["unit"] } } }),
          doing(4),
          doing(5, { status: "done", updatedAt: Date.now() }),
          doing(6, { archived: true }),
        ],
      })
    )
    expect(h.moving).toEqual([
      { id: 4, title: "task 4", who: null, state: "", busy: false, red: false },
      { id: 3, title: "task 3", who: null, state: "PR #8 · unit failed", busy: false, red: true },
      { id: 2, title: "task 2", who: "moss", state: "PR #7 · checks running", busy: false, red: false },
    ])
    expect(h.more).toBe(1)
    expect(h.doneToday).toBe(1)
  })

  test("names who is running what when a task has no PR yet", () => {
    const h = homeOf(
      channel({
        people: [agent("fern", { activity: { state: "working", tool: "mcp__kiwi__send" } })],
        tasks: [{ ...task(1, "sync"), status: "doing", owner: "fern", history: [] }],
      })
    )
    expect(h.moving[0]).toMatchObject({ who: "fern", state: "running send", busy: true })
  })

  test("lists every agent, working first, with the task it has and what it's doing, and counts red checks", () => {
    const doing = (id: number, more: Partial<Task> = {}): Task => ({ ...task(id, `task ${id}`), status: "doing", history: [], updatedAt: id, ...more })
    const h = homeOf(
      channel({
        nicknames: new Map([["fern", "Fern"]]),
        people: [
          agent("moss"),
          agent("zed", { presence: "offline", activity: { state: "working", tool: "Bash" } }),
          agent("fern", { activity: { state: "working", tool: "Bash", since: 5 } }),
          agent("ivy", { activity: { state: "waiting" } }),
          agent("old", { left: true }),
          { ...agent("me"), you: true },
        ],
        tasks: [
          doing(1, { owner: "fern" }),
          doing(2, { owner: "fern", updatedAt: 9, stage: "red", pr: { repo: "r", number: 8, title: "", url: "", state: "open", checks: "fail", ticks: { passed: 0, running: 0, failed: ["unit"] } } }),
          doing(3, { owner: "moss", status: "done" }),
        ],
      })
    )
    expect(h.agents).toEqual([
      { name: "fern", nick: "Fern", state: "working", doing: "running Bash", since: 5, task: { id: 2, title: "task 2" } },
      { name: "ivy", nick: "ivy", state: "waiting", doing: "waiting for a person", task: null },
      { name: "moss", nick: "moss", state: "idle", doing: "idle", task: null },
      { name: "zed", nick: "zed", state: "away", doing: "offline", task: null },
    ])
    expect(h.working).toBe(1)
    expect(h.red).toBe(1)
  })

  test("the last word in #general reads as plain text from its author's nickname", () => {
    const said = saidIn([
      { seq: 1, from: "owl", at: 1, text: wrote("## Plan\n- ship **it**"), where: { kind: "room", room: "general" } },
      { seq: 2, from: "owl", at: 2, text: wrote("in a thread"), where: { kind: "room", room: "general" }, inThread: 1 },
      { seq: 3, from: "owl", at: 3, text: wrote("owl took T4"), where: { kind: "room", room: "general" }, system: true },
      { seq: 4, from: "owl", at: 4, text: wrote("in a task"), where: { kind: "task", task: 4 } },
    ])
    expect(said).toEqual({ from: "owl", at: 1, text: "## Plan\n- ship **it**" })
    expect(homeOf(channel({ nicknames: new Map([["owl", "lead"]]) }), said).said).toEqual({ from: "lead", at: 1, text: "Plan ship it" })
    expect(saidIn([])).toBeNull()
  })

  test("the last word in #general names agents by nickname, not handle (#1763)", () => {
    const said = saidIn([{ seq: 1, from: "jow", at: 1, text: wrote("@gentle-otter ship it"), where: { kind: "room", room: "general" } }])
    expect(homeOf(channel({ nicknames: new Map([["gentle-otter", "lead"]]) }), said).said?.text).toBe("@lead ship it")
  })
})

describe("takeTurns", () => {
  test("takes one from each list in turn, so every channel's first ask shows", () => {
    expect(takeTurns([["a1", "a2", "a3"], [], ["b1"], ["c1", "c2"]])).toEqual(["a1", "b1", "c1", "a2", "c2", "a3"])
    expect(takeTurns([])).toEqual([])
  })
})
