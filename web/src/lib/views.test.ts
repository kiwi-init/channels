import { describe, expect, test } from "bun:test"

import type { ChannelState, GithubPr, Task, TaskState } from "@kiwi/core/state.ts"
import { inView, mergedSince, startOfDay, viewCounts } from "./views"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 18, 15)

const task = (id: number, state: TaskState, updatedAt = NOW, extra: Partial<Task> = {}): Task => ({
  id,
  title: `t${id}`,
  state,
  createdBy: "jon",
  createdAt: 0,
  updatedAt,
  notes: [],
  workedBy: [],
  rounds: [],
  ...extra,
})

describe("the sidebar's views", () => {
  test("each counts its tasks; done counts only this week; archived counts nowhere", () => {
    const tasks = new Map(
      [task(1, "open"), task(2, "doing"), task(3, "doing"), task(4, "review"), task(5, "done", NOW - DAY), task(6, "done", NOW - 8 * DAY), task(7, "doing", NOW, { archived: true })].map((t) => [
        t.id,
        t,
      ])
    )
    const counts = viewCounts({ tasks }, NOW, 3, new Set([1, 5]))
    expect(counts).toEqual({ everything: 5, needs: 3, doing: 2, review: 1, done: 1 })
  })

  test("a task waiting on people is in Needs you until it is done", () => {
    const waiting = new Set([1, 2])
    expect(inView(task(1, "doing"), "needs", NOW, waiting)).toBe(true)
    expect(inView(task(2, "done"), "needs", NOW, waiting)).toBe(false)
    expect(inView(task(3, "doing"), "needs", NOW, waiting)).toBe(false)
  })

  test("merged today counts the PRs merged since the day began", () => {
    const pr = (number: number, state: GithubPr["state"], at: number): GithubPr => ({ repo: "o/r", number, state, at, seq: number })
    const github: ChannelState["github"] = { prs: new Map([pr(1, "merged", NOW - 60_000), pr(2, "merged", NOW - 2 * DAY), pr(3, "open", NOW)].map((p) => [String(p.number), p])), checks: new Map() }
    expect(mergedSince({ github }, startOfDay(NOW))).toBe(1)
  })
})
