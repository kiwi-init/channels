import { describe, expect, test } from "bun:test"

import { channelLanes, dayWindow, HOUR, homeLanes } from "~/calm/day"
import type { HomeAgent, Person, Task } from "~/model"
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
  test("the window starts on the hour at least four hours back and ends an hour ahead", () => {
    const { start, end } = dayWindow(NOW - 10 * MIN, NOW)
    expect(start).toBe(NOW - 4 * HOUR)
    expect(end).toBe(NOW + HOUR)
  })

  test("a lane per agent with work, newest first; done work ends when it landed, work in flight runs to now and past it", () => {
    const start = NOW - 4 * HOUR
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
    const doing = lanes[0]!.spans[0]!
    expect(doing).toMatchObject({ task: 2, state: "doing", to: NOW })
    expect(doing.until).toBeGreaterThan(NOW)
  })

  test("work that ended before the window stays off it, and work begun before it starts at its edge", () => {
    const start = NOW - 4 * HOUR
    const lanes = channelLanes(
      channel(
        [agent("old"), agent("long")],
        [task(1, "old", "done", NOW - 9 * HOUR, { history: [{ seq: 2, by: "old", at: NOW - 8 * HOUR, what: "done" }] }), task(2, "long", "doing", NOW - 9 * HOUR)]
      ),
      start,
      NOW
    )
    expect(lanes.map((l) => l.name)).toEqual(["long"])
    expect(lanes[0]!.spans[0]!.from).toBe(start)
  })

  test("with only a channel's summary, working agents get a lane and waiting ones a mark", () => {
    const agents: HomeAgent[] = [
      { name: "win", nick: "win", state: "working", doing: "running Bash", since: NOW - 20 * MIN, task: { id: 4, title: "Tag it" } },
      { name: "flint", nick: "flint", state: "waiting", doing: "waiting", since: NOW - 5 * MIN, task: null },
      { name: "sumi", nick: "sumi", state: "idle", doing: "idle", task: null },
    ]
    const lanes = homeLanes({ agents }, NOW - 4 * HOUR, NOW)
    expect(lanes.map((l) => [l.name, l.spans.length, l.asks.length])).toEqual([
      ["win", 1, 0],
      ["flint", 0, 1],
    ])
  })
})
