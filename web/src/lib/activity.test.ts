import { describe, expect, test } from "bun:test"

import { PROTOCOL_VERSION, type Event, type Message } from "@kiwi/core/protocol.ts"
import type { TaskState } from "@kiwi/core/state.ts"

import { digestTask, isActivity } from "./activity"
import { activityOf, digestPrs } from "./activity-entries"

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
const digest = (seq: number, body: string) => msg(seq, { kind: "done", body })
const tasks = (entries: [number, TaskState][]) => new Map(entries.map(([id, state]) => [id, { state }]))

describe("a done summary", () => {
  test("names its task by the id it opens with, and only on a done message", () => {
    expect(digestTask(digest(9, "T4 done: Fix the bar · by dev"))).toBe(4)
    expect(digestTask(digest(9, "T4 cancelled: Fix the bar · Duplicate of T5"))).toBe(4)
    expect(digestTask(digest(9, "Done with T4: Fix the bar"))).toBeNull()
    expect(digestTask(msg(9, { body: "T4 done: Fix the bar" }))).toBeNull()
  })

  test("its PRs come from the PR part, never from the note", () => {
    expect(digestPrs("T4 done: Fix · see a/b#1 · PR ana/kiwi#640, ana/site#12 · by dev")).toEqual([
      { repo: "ana/kiwi", number: 640 },
      { repo: "ana/site", number: 12 },
    ])
    expect(digestPrs("T4 done: Fix · see ana/kiwi#1 · by dev")).toEqual([])
  })
})

describe("what #general folds", () => {
  test("events and the summaries of known tasks; chat stays chat", () => {
    const known = tasks([[4, "done"]])
    expect(isActivity(ev(5, { op: "task.update", task: 4, state: "done" }), known)).toBe(true)
    expect(isActivity(ev(6, { op: "charter.set", text: "x" }), known)).toBe(true)
    expect(isActivity(digest(7, "T4 done: Fix the bar"), known)).toBe(true)
    expect(isActivity(digest(8, "T99 done: Not a task here"), known)).toBe(false)
    expect(isActivity(msg(9, { body: "T4 done: just saying" }), known)).toBe(false)
  })

  test("one entry per task, in the order it first moved, with the summary's PRs", () => {
    const run = [
      ev(10, { op: "task.update", task: 4, state: "done" }),
      ev(11, { op: "task.add", title: "Next" }),
      digest(12, "T4 done: Fix the bar · PR ana/kiwi#640 · by dev"),
      ev(13, { op: "charter.set", text: "x" }),
    ]
    expect(
      activityOf(
        run,
        tasks([
          [4, "done"],
          [11, "todo"],
        ])
      )
    ).toEqual([
      { kind: "task", id: 4, seqs: [10, 12], prs: [{ repo: "ana/kiwi", number: 640 }] },
      { kind: "task", id: 11, seqs: [11], prs: [] },
      { kind: "event", m: run[3]! },
    ])
  })

  test("GitHub's news in a run is one entry, and an event about an unknown task stays an event", () => {
    const gh = (seq: number) => ev(seq, { op: "github", items: [] })
    const lost = ev(22, { op: "task.update", task: 77, state: "doing" })
    expect(activityOf([gh(20), lost, gh(23)], tasks([]))).toEqual([
      { kind: "github", messages: [gh(20), gh(23)] },
      { kind: "event", m: lost },
    ])
  })
})
