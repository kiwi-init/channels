import { describe, expect, test } from "bun:test"

import { channelLanes, dayStart, HOUR, homeLanes } from "~/calm/day"
import type { HomeAgent, Person, QuestionAsk, Task } from "~/model"
import { wrote } from "~/words"

const NOW = Date.UTC(2026, 10, 7, 11, 0)
const MIN = 60_000

const agent = (name: string, over: Partial<Person> = {}): Person => ({ name, kind: "agent", owner: false, you: false, presence: "online", ...over }) as Person

const task = (id: number, owner: string, status: Task["status"], from: number, over: Partial<Task> = {}): Task =>
  ({
    id,
    title: wrote(`Task ${id}`),
    status,
    owner,
    createdBy: "jow",
    createdAt: from,
    updatedAt: NOW,
    notes: [],
    rounds: [],
    history: [{ seq: 1, by: owner, at: from, what: "started" }],
    archived: false,
    ...over,
  }) as Task

const channel = (people: Person[], tasks: Task[]) => ({ people, tasks, asks: [], nicknames: new Map<string, string>() })

describe("the AFK day", () => {
  test("the trail starts on the hour, three hours back or when you left if that was earlier", () => {
    expect(dayStart(NOW - 10 * MIN, NOW)).toBe(NOW - 3 * HOUR)
    expect(dayStart(NOW - 5 * HOUR - 20 * MIN, NOW)).toBe(NOW - 5 * HOUR)
  })

  test("a lane per agent with work, busy ones first; done work ends when it landed and says so, work in flight runs to now", () => {
    const start = NOW - 3 * HOUR
    const lanes = channelLanes(
      channel(
        [agent("win"), agent("pixel"), agent("idle"), agent("jow", { kind: "human" })],
        [
          task(1, "pixel", "done", NOW - 3 * HOUR, {
            history: [
              { seq: 1, by: "pixel", at: NOW - 3 * HOUR, what: "started" },
              { seq: 2, by: "pixel", at: NOW - 2 * HOUR, what: "done" },
            ],
          }),
          task(2, "win", "doing", NOW - 30 * MIN),
          task(3, "win", "todo", NOW - 10 * MIN),
        ]
      ),
      start,
      NOW
    )
    expect(lanes.map((l) => l.name)).toEqual(["win", "pixel"])
    expect(lanes[1]!.spans[0]).toMatchObject({ task: 1, state: "done", from: NOW - 3 * HOUR, to: NOW - 2 * HOUR })
    expect(lanes[1]!.now).toEqual({ tone: "done", text: "Task 1", since: NOW - 2 * HOUR })
    expect(lanes[0]!.spans[0]).toMatchObject({ task: 2, state: "doing", to: NOW })
    expect(lanes[0]!.now).toEqual({ tone: "doing", text: "Task 2", since: NOW - 30 * MIN })
  })

  test("an agent that asked you something leads with the ask, whatever it was doing", () => {
    const ask: QuestionAsk = { kind: "question", id: "q1", from: "flint", at: NOW - 12 * MIN, text: wrote("Merge the relay change?"), label: "", options: [], holds: [] }
    const lanes = channelLanes({ ...channel([agent("win"), agent("flint")], [task(1, "win", "doing", NOW - HOUR), task(2, "flint", "doing", NOW - HOUR)]), asks: [ask] }, NOW - 3 * HOUR, NOW)
    expect(lanes.map((l) => [l.name, l.now.tone, l.now.label, l.now.text])).toEqual([
      ["flint", "ask", "Asks you", "Merge the relay change?"],
      ["win", "doing", undefined, "Task 1"],
    ])
  })

  test("work that ended before the trail stays off it, and work begun before it keeps its real start", () => {
    const start = NOW - 3 * HOUR
    const lanes = channelLanes(
      channel(
        [agent("old"), agent("long")],
        [task(1, "old", "done", NOW - 9 * HOUR, { history: [{ seq: 2, by: "old", at: NOW - 8 * HOUR, what: "done" }] }), task(2, "long", "doing", NOW - 9 * HOUR)]
      ),
      start,
      NOW
    )
    expect(lanes.map((l) => l.name)).toEqual(["long"])
    expect(lanes[0]!.spans[0]!.from).toBe(NOW - 9 * HOUR)
  })

  test("with only a channel's summary, waiting agents ask and working ones carry their task", () => {
    const agents: HomeAgent[] = [
      { name: "win", nick: "win", state: "working", doing: "running Bash", since: NOW - 20 * MIN, task: { id: 4, title: "Tag it" } },
      { name: "flint", nick: "flint", state: "waiting", doing: "waiting", since: NOW - 5 * MIN, task: null },
      { name: "sumi", nick: "sumi", state: "idle", doing: "idle", task: null },
    ]
    const lanes = homeLanes({ agents }, NOW - 3 * HOUR, NOW)
    expect(lanes.map((l) => [l.name, l.spans.length, l.now.tone, l.now.label ?? l.now.text])).toEqual([
      ["flint", 0, "ask", "Waiting for you"],
      ["win", 1, "doing", "Tag it"],
    ])
  })
})
