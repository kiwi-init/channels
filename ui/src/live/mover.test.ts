import { describe, expect, test } from "bun:test"

import type { Event, Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { tasksOf } from "~/live/map"
import type { Channel, Task } from "~/model"
import { moverTag, moverWords, quietFor, quietTasks, quietWords, seesQuiet } from "~/tasks/mover"

const HEAD = "1".repeat(40)
const MIN = 60_000

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "owl", pk: "pk-owl", owner: false, at: 0, active: true, kind: "agent", role: "lead", runs: { harness: "claude" } },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
  { name: "mac", pk: "pk-mac", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

const event = (seq: number, from: string, ev: Event): Wire => ({ v: 1, id: `e${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "event", body: "", ev, ts: seq * 1000, rts: seq * 1000 }) as Wire

const TASK = 2

const shown = (wires: Wire[], now: number, me = "jow"): Task => {
  const task = tasksOf(fold(wires, roster, now), new Set(), me, wires, now).find((t) => t.id === TASK)
  if (!task) throw new Error("no task")
  return task
}

const channel = (tasks: Task[], you = "jow"): Channel => ({ you, youOwn: you === "jow", lead: "owl", tasks, nicknames: new Map() }) as unknown as Channel

const inReview = (): Wire[] => [
  event(1, "jow", { op: "landing.set", then: "merge" }),
  event(TASK, "jow", { op: "task.add", title: "export", owner: "win", review: "mac" }),
  event(3, "win", { op: "task.update", task: TASK, state: "review", at: HEAD }),
]

describe("a task shows whose move it is and how long it has been quiet (#3930 §1 and §2)", () => {
  test("a task in review is its reviewer's move, and the row says so because that isn't the owner", () => {
    const task = shown(inReview(), 10_000)
    expect(task.mover).toEqual({ kind: "member", name: "mac", move: "review" })
    expect(moverWords(channel([task]), task, 10_000)).toBe("mac to review it")
    expect(moverTag(channel([task]), task, 10_000)).toBe("mac to review it")
  })

  test("a task its owner works on shows no tag on the row, and the panel still names the owner", () => {
    const wires = [event(TASK, "jow", { op: "task.add", title: "export", owner: "win" }), event(3, "win", { op: "task.update", task: TASK, state: "doing" })]
    const task = shown(wires, 10_000)
    expect(task.mover).toEqual({ kind: "member", name: "win", move: "work" })
    expect(moverTag(channel([task]), task, 10_000)).toBeNull()
    expect(moverWords(channel([task]), task, 10_000)).toBe("win to work on it")
  })

  test("a task with no owner is the lead's to give out", () => {
    const task = shown([event(TASK, "jow", { op: "task.add", title: "export" })], 10_000)
    expect(task.mover).toEqual({ kind: "member", name: "owl", move: "assign" })
  })

  test("a todo behind its owner's other work is waiting, with the count ahead", () => {
    const wires = [
      event(1, "jow", { op: "task.add", title: "first", owner: "win" }),
      event(TASK, "jow", { op: "task.add", title: "second", owner: "win" }),
      event(3, "win", { op: "task.update", task: 1, state: "doing" }),
    ]
    const task = shown(wires, 10_000)
    expect(task.mover).toEqual({ kind: "waiting", owner: "win", ahead: 1 })
    expect(task.quiet).toBeUndefined()
    expect(moverTag(channel([task]), task, 10_000)).toBe("waiting, 1 ahead")
  })

  test("quiet starts at the channel's own N and names the step that is recorded", () => {
    const set = event(4, "jow", { op: "quiet.set", minutes: 5 })
    const wires = [...inReview(), set]
    const fresh = shown(wires, 3000 + 4 * MIN)
    expect(fresh.quiet).toEqual({ with: "mac", since: 3000, from: 3000 + 5 * MIN, every: 5 * MIN, step: 0 })
    expect(quietFor(fresh, 3000 + 4 * MIN)).toBeNull()
    expect(quietWords(channel([fresh]), fresh, 3000 + 6 * MIN)).toBe("quiet 6m with mac")
    const nudged = { ...event(5, "jow", { op: "task.nudge", task: TASK, mover: "mac", since: 3, step: 1 }), ts: 3000 + 6 * MIN, rts: 3000 + 6 * MIN }
    const stepped = shown([...wires, nudged], 3000 + 7 * MIN)
    expect(stepped.quiet?.step).toBe(1)
    expect(quietWords(channel([stepped]), stepped, 3000 + 7 * MIN)).toBe("quiet 7m with mac (a wake is due)")
  })

  test("a person with the move is never on the quiet list", () => {
    const wires = [event(TASK, "jow", { op: "task.add", title: "export", owner: "win", review: "jow" }), event(3, "win", { op: "task.update", task: TASK, state: "review", at: HEAD })]
    const task = shown(wires, 3000 + 90 * MIN)
    expect(task.mover).toEqual({ kind: "member", name: "jow", move: "review" })
    expect(task.quiet).toBeUndefined()
  })

  test("the quiet list is for the owner and the lead, oldest first", () => {
    const now = 3000 + 30 * MIN
    const task = shown(inReview(), now)
    const older: Task = { ...task, id: 9, quiet: { with: "win", since: 0, from: 20 * MIN, every: 20 * MIN, step: 2 } }
    expect(quietTasks(channel([task, older]), now).map((t) => t.id)).toEqual([9, TASK])
    expect(seesQuiet(channel([task]))).toBe(true)
    expect(seesQuiet(channel([task], "owl"))).toBe(true)
    expect(seesQuiet(channel([task], "win"))).toBe(false)
  })
})

describe("landing steps on the task (#3930 §3)", () => {
  const approved = (): Wire[] => [...inReview(), event(4, "mac", { op: "task.update", task: TASK, state: "done", verdict: "approved", round: 1, at: HEAD })]

  test("before approval every step is still to come; after it the first is current with its mover", () => {
    expect(shown(inReview(), 10_000).steps).toEqual([{ id: "s1", words: expect.anything(), by: "win", state: "next" }])
    const task = shown(approved(), 10_000)
    expect(task.status).toBe("landing")
    expect(task.steps?.map((s) => [s.id, s.by, s.state, s.yours])).toEqual([["s1", "win", "current", undefined]])
    expect(task.mover).toEqual({ kind: "member", name: "win", move: "land" })
    expect(shown(approved(), 10_000, "win").steps?.[0]?.yours).toBe(true)
  })

  test("a step given to a person is theirs to end, and ending it shows it done", () => {
    const mine = event(5, "jow", { op: "task.steps", task: TASK, edit: { kind: "by", id: "s1", by: "jow" } })
    const task = shown([...approved(), mine], 10_000)
    expect(task.steps?.[0]).toMatchObject({ id: "s1", by: "jow", state: "current", yours: true })
    const ended = shown([...approved(), mine, event(6, "jow", { op: "task.landed", task: TASK, step: "s1" })], 10_000)
    expect(ended.status).toBe("done")
    expect(ended.steps?.[0]?.state).toBe("done")
    expect(ended.mover).toBeUndefined()
  })

  test("a step that waits shows its reason and end, belongs to nobody until then, and can't be ended by its mover", () => {
    const wait = { ...event(5, "jow", { op: "task.steps", task: TASK, edit: { kind: "wait", id: "s1", reason: "the freeze ends Monday", ms: 60 * MIN } }), ts: 5000, rts: 5000 }
    const now = 5000 + 10 * MIN
    const task = shown([...approved(), wait], now, "win")
    expect(task.steps?.[0]?.wait?.until).toBe(5000 + 60 * MIN)
    expect(task.steps?.[0]?.yours).toBeUndefined()
    expect(task.mover).toMatchObject({ kind: "hold", until: 5000 + 60 * MIN, then: "win" })
    expect(moverWords(channel([task], "win"), task, now)).toBe("Nobody's move for 50m: the freeze ends Monday")
    expect(moverWords(channel([task], "win"), task, 5000 + 61 * MIN)).toBe("win to land it")
  })
})
