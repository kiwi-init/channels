import { describe, expect, test } from "bun:test"

import type { AskHead, ChannelState, GithubPr, Task, TaskState } from "@kiwi/core/state.ts"
import { inView, mergedSince, startOfDay, taskGroups, viewCounts } from "./views"

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
      [task(1, "todo"), task(2, "doing"), task(3, "doing"), task(4, "review"), task(5, "done", NOW - DAY), task(6, "done", NOW - 8 * DAY), task(7, "doing", NOW, { archived: true })].map((t) => [
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
    const github: ChannelState["github"] = {
      prs: new Map([pr(1, "merged", NOW - 60_000), pr(2, "merged", NOW - 2 * DAY), pr(3, "open", NOW)].map((p) => [String(p.number), p])),
      checks: new Map(),
      issues: new Map(),
      rules: new Map(),
      releases: new Map(),
    }
    expect(mergedSince({ github }, startOfDay(NOW))).toBe(1)
  })

  test("the board groups by the person's message each task serves: latest-moving ask first, unfiled last, in progress first within each", () => {
    const tasks = new Map(
      [
        task(1, "doing", NOW - 5, { ask: 10 }),
        task(2, "review", NOW - 1, { ask: 20 }),
        task(3, "todo", NOW - 9, { ask: 10 }),
        task(4, "done", NOW - 60_000, { ask: 10 }),
        task(5, "done", NOW - 2 * DAY, { ask: 20 }),
        task(6, "todo", NOW),
        task(7, "review", NOW - 7, { ask: 10 }),
        task(8, "done", NOW - 9 * DAY, { ask: 30 }),
      ].map((t) => [t.id, t])
    )
    const head = (id: number, words: string): AskHead => ({ id, by: "jon", words, at: 0 })
    const askHeads = new Map([head(10, "ship v2"), head(20, "fix the board"), head(30, "old")].map((h) => [h.id, h]))
    const ids = (view: Parameters<typeof taskGroups>[1]) => taskGroups({ tasks, askHeads }, view, NOW).map((g) => [g.ask?.id ?? null, g.tasks.map((t) => t.id)])
    expect(ids("everything")).toEqual([
      [20, [2, 5]],
      [10, [1, 7, 3, 4]],
      [null, [6]],
    ])
    expect(ids("review")).toEqual([
      [20, [2]],
      [10, [7]],
    ])
    expect(ids("done")).toEqual([
      [10, [4]],
      [20, [5]],
    ])
    expect(ids("needs")).toEqual([])
  })
})
