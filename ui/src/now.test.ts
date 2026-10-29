import { describe, expect, test } from "bun:test"
import type { Channel, Message, Person, PullRequest, Task } from "~/model"
import { headerLine, lanesOf, laneOf, nowOf, stageWords, startOfDay } from "~/now"

const NOW = new Date(2026, 9, 28, 15, 0).getTime()
const ago = (min: number): number => NOW - min * 60_000

const pr = (number: number, more: Partial<PullRequest> = {}): PullRequest => ({
  repo: "o/r",
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  state: "open",
  checks: "none",
  ...more,
})

const task = (id: number, more: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  status: "doing",
  createdBy: "jow",
  createdAt: ago(600),
  updatedAt: ago(id),
  notes: [],
  rounds: [],
  archived: false,
  ...more,
})

const agent = (name: string, more: Partial<Person> = {}): Person => ({ name, kind: "agent", owner: false, you: false, presence: "online", lastSeen: NOW, joined: 0, messages: 0, ...more })

const channel = (more: Partial<Channel>): Channel => ({
  code: "c",
  title: "c",
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

describe("stageWords", () => {
  test("names the one failed check", () => {
    expect(stageWords(task(1, { stage: "red", pr: pr(4, { ticks: { passed: 2, running: 0, failed: ["lint"] } }) }))).toEqual({ text: "PR #4 · lint failed", red: true })
  })
  test("counts several failed checks", () => {
    expect(stageWords(task(1, { stage: "red", pr: pr(4, { ticks: { passed: 0, running: 0, failed: ["a", "b"] } }) })).text).toBe("PR #4 · 2 checks failed")
  })
  test("tells running from passed and from no checks", () => {
    expect(stageWords(task(1, { stage: "proving", pr: pr(4, { ticks: { passed: 1, running: 1, failed: [] } }) })).text).toBe("PR #4 · checks running")
    expect(stageWords(task(1, { stage: "proving", pr: pr(4, { ticks: { passed: 3, running: 0, failed: [] } }) })).text).toBe("PR #4 · checks passed")
    expect(stageWords(task(1, { stage: "proving", pr: pr(4) })).text).toBe("PR #4 · no checks yet")
  })
  test("review owed, merged, shipped, no PR yet", () => {
    expect(stageWords(task(1, { stage: "yours" })).text).toBe("review owed")
    expect(stageWords(task(1, { stage: "done", pr: pr(4, { state: "merged" }) })).text).toBe("PR #4 merged")
    expect(stageWords(task(1, { stage: "done", release: "2026.10.9", pr: pr(4, { state: "merged" }) })).text).toBe("PR #4 · shipped in 2026.10.9")
    expect(stageWords(task(1, { stage: "building" })).text).toBe("no PR yet")
  })
})

describe("nowOf", () => {
  test("lists working tasks newest first, five at most, and what was done today", () => {
    const tasks = [
      ...[1, 2, 3, 4, 5, 6].map((id) => task(id)),
      task(7, { status: "todo" }),
      task(8, { status: "todo", pr: pr(8) }),
      task(9, { status: "doing", archived: true }),
      task(10, { status: "done", pr: pr(10, { state: "merged", mergedAt: ago(30) }), updatedAt: ago(60 * 24 * 3) }),
      task(11, { status: "done", updatedAt: startOfDay(NOW) - 1 }),
      task(12, { status: "done", cancelled: true, updatedAt: ago(5) }),
    ]
    const now = nowOf(channel({ tasks, next: "ship it" }), NOW)
    expect(now.next).toBe("ship it")
    expect(now.working.map((t) => t.id)).toEqual([1, 2, 3, 4, 5])
    expect(now.more).toBe(2)
    expect(now.done.map((t) => t.id)).toEqual([10])
    expect(now.doneCount).toBe(1)
  })
})

describe("headerLine", () => {
  test("counts busy agents, today's merges and what needs you", () => {
    const people = [agent("a", { activity: { state: "working" } }), agent("b", { activity: { state: "idle" } }), agent("c", { activity: { state: "working" }, presence: "offline" })]
    expect(headerLine(channel({ people, mergedAt: [ago(10), ago(60 * 24)] }), 2, NOW)).toEqual(["1 working", "1 merged today", "2 need you"])
    expect(headerLine(channel({ people: [] }), 1, NOW)).toEqual(["1 needs you"])
    expect(headerLine(channel({}), 0, NOW)).toEqual([])
  })
})

describe("lanes", () => {
  const win = agent("win", { display: "Win", load: { level: "busy", doing: [1], queued: [3], waiting: [2] } })
  const lead = agent("atlas", { load: { level: "free", doing: [], queued: [], waiting: [] } })
  const tasks = [
    task(1, { owner: "win" }),
    task(2, { owner: "win", status: "waiting" }),
    task(3, { owner: "win", status: "todo" }),
    task(4, { owner: "pixel", status: "review", pr: pr(44) }),
    task(5, { owner: "pixel", status: "review", pr: pr(45, { state: "merged" }) }),
  ]
  const msg = (seq: number, more: Partial<Message>): Message => ({ seq, from: "win", at: ago(100 - seq), text: "", where: { kind: "room", room: "general" }, ...more })
  const messages = [
    msg(1, { system: true, task: 1, text: "Win took T1 “Task 1”" }),
    msg(2, { text: "just chatting" }),
    msg(3, { task: 1, text: "Finished T1:\n  PR is up" }),
    msg(4, { system: true, task: 2, text: "Win moved T2 to review" }),
    msg(5, { system: true, task: 2, text: "Win asked for review" }),
    msg(6, { from: "atlas", system: true, task: 3, text: "atlas added T3" }),
  ]
  const ch = channel({ lead: "atlas", people: [agent("ridge", { presence: "offline" }), win, lead, agent("gone", { left: true })], tasks, messages })

  test("an agent's lane holds its tasks, its queue and its last three task events", () => {
    const lane = laneOf(ch, win)
    expect(lane.current.map((t) => t.id)).toEqual([1, 2])
    expect(lane.next.map((t) => t.id)).toEqual([3])
    expect(lane.watching).toEqual([])
    expect(lane.recent.map((r) => r.text)).toEqual(["asked for review", "moved T2 to review", "Finished T1: PR is up"])
  })

  test("the lead watches other agents' open PRs", () => {
    expect(laneOf(ch, lead).watching.map((p) => [p.number, p.task])).toEqual([[44, 4]])
  })

  test("the lead comes first, then busy agents, and agents who left have no lane", () => {
    expect(lanesOf({ ...ch, people: [...ch.people, agent("busy", { activity: { state: "working" } })] }).map((l) => l.person.name)).toEqual(["atlas", "busy", "win", "ridge"])
  })
})
