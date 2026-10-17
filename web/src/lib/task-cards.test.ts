import { describe, expect, test } from "bun:test"

import { PROTOCOL_VERSION, type Event, type Message } from "@mc/protocol.ts"
import type { TaskState } from "@mc/state.ts"

import { foldTaskEvents, isTaskCard, taskOfEvent } from "./task-cards"

const msg = (seq: number, extra: Partial<Message> = {}): Message => ({
  v: PROTOCOL_VERSION,
  id: String(seq),
  from: "bot",
  kind: "msg",
  body: `#${seq}`,
  ts: seq,
  seq,
  sigOk: true,
  ...extra,
})
const ev = (seq: number, e: Event) => msg(seq, { kind: "event", ev: e })
const tasks = (entries: [number, TaskState][]) => new Map(entries.map(([id, state]) => [id, { state }]))

describe("taskOfEvent", () => {
  test("names the task an event made or changed, and nothing for other messages", () => {
    expect(taskOfEvent(ev(4, { op: "task.add", title: "t" }))).toBe(4)
    expect(taskOfEvent(ev(5, { op: "task.claim", task: 4 }))).toBe(4)
    expect(taskOfEvent(ev(6, { op: "task.update", task: 4, state: "doing" }))).toBe(4)
    expect(taskOfEvent(ev(7, { op: "charter.set", text: "x" }))).toBeNull()
    expect(taskOfEvent(msg(8))).toBeNull()
  })
})

describe("isTaskCard", () => {
  test("only the event that made a task still open becomes a card", () => {
    const made = ev(1, { op: "task.add", title: "t" })
    expect(isTaskCard(made, tasks([[1, "doing"]]))).toBe(true)
    expect(isTaskCard(made, tasks([[1, "done"]]))).toBe(false)
    expect(isTaskCard(made, tasks([]))).toBe(false)
    expect(isTaskCard(ev(2, { op: "task.claim", task: 1 }), tasks([[1, "doing"]]))).toBe(false)
  })
})

describe("foldTaskEvents", () => {
  test("an open task keeps the event that made it; a done one keeps how it ended; the rest stays", () => {
    const list = [
      ev(1, { op: "task.add", title: "open" }),
      msg(2),
      ev(3, { op: "task.claim", task: 1 }),
      ev(4, { op: "task.add", title: "done" }),
      ev(5, { op: "task.update", task: 4, state: "review" }),
      ev(6, { op: "charter.set", text: "x" }),
      ev(7, { op: "task.update", task: 4, state: "done" }),
      ev(8, { op: "task.update", task: 99, state: "doing" }),
    ]
    const kept = foldTaskEvents(
      list,
      tasks([
        [1, "doing"],
        [4, "done"],
      ])
    ).map((m) => m.seq)
    expect(kept).toEqual([1, 2, 6, 7, 8])
  })
})
