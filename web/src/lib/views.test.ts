import { describe, expect, test } from "bun:test"

import { fold, type AskHead, type ChannelState, type GithubPr, type GithubRelease, type Task, type TaskState } from "@kiwi/core/state.ts"

import { inView, mergedSince, NEXT_RELEASE_NOTE, startOfDay, taskGroups, viewCounts } from "./views"

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

const board = (tasks: Task[], extra: Partial<ChannelState> = {}): ChannelState => ({ ...fold([], [], NOW), tasks: new Map(tasks.map((t) => [t.id, t])), ...extra })

describe("the sidebar's views", () => {
  test("each counts its tasks; done counts only this week; archived counts nowhere", () => {
    const state = board([task(1, "todo"), task(2, "doing"), task(3, "doing"), task(4, "review"), task(5, "done", NOW - DAY), task(6, "done", NOW - 8 * DAY), task(7, "doing", NOW, { archived: true })])
    const counts = viewCounts(state, NOW, 3, new Set([1, 5]))
    expect(counts).toEqual({ everything: 5, needs: 3, doing: 2, review: 1, done: 1 })
  })

  test("a task waiting on people is in Needs you until it is done", () => {
    const waiting = new Set([1, 2])
    const state = board([])
    expect(inView(state, task(1, "doing"), "needs", NOW, waiting)).toBe(true)
    expect(inView(state, task(2, "done"), "needs", NOW, waiting)).toBe(false)
    expect(inView(state, task(3, "doing"), "needs", NOW, waiting)).toBe(false)
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
    const tasks = [
      task(1, "doing", NOW - 5, { ask: 10 }),
      task(2, "review", NOW - 1, { ask: 20 }),
      task(3, "todo", NOW - 9, { ask: 10 }),
      task(4, "done", NOW - 60_000, { ask: 10 }),
      task(5, "done", NOW - 2 * DAY, { ask: 20 }),
      task(6, "todo", NOW),
      task(7, "review", NOW - 7, { ask: 10 }),
      task(8, "done", NOW - 9 * DAY, { ask: 30 }),
    ]
    const head = (id: number, words: string): AskHead => ({ id, by: "jon", words, at: 0 })
    const askHeads = new Map([head(10, "ship v2"), head(20, "fix the board"), head(30, "old")].map((h) => [h.id, h]))
    const state = board(tasks, { askHeads })
    const ids = (view: Parameters<typeof taskGroups>[1]) => taskGroups(state, view, NOW).map((g) => [g.head.kind === "ask" ? (g.head.ask?.id ?? null) : g.key, g.tasks.map((t) => t.id)])
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

  test("with releases known, open work stays under its ask and finished work groups by release: next (named by the release.next note), each release newest first, cancelled last", () => {
    const pr = (number: number, branch: string, state: GithubPr["state"], at: number): GithubPr => ({ repo: "o/r", number, branch, state, at, seq: number })
    const release = (tag: string, at: number, prs: number[]): GithubRelease => ({ repo: "o/r", tag, at, shas: [], prs, seq: at })
    const askHeads = new Map([[10, { id: 10, by: "jon", words: "ship v2", at: 0 }]])
    const state = board(
      [
        task(1, "doing", NOW, { ask: 10 }),
        task(2, "doing", NOW - 5, { ask: 10 }),
        task(3, "done", NOW - DAY, { ask: 10 }),
        task(4, "done", NOW - 2 * DAY, { ask: 10 }),
        task(5, "done", NOW - 3, { cancelled: true }),
        task(6, "done", NOW - 9 * DAY),
      ],
      {
        askHeads,
        branchPrefix: "T",
        facts: new Map([[NEXT_RELEASE_NOTE, { key: NEXT_RELEASE_NOTE, value: "2026.10.0", by: "lead", ts: NOW, seq: 1 }]]),
        github: {
          prs: new Map(
            [pr(11, "T1-a", "open", NOW), pr(12, "T2-b", "merged", NOW - 10), pr(13, "T3-c", "merged", NOW - DAY), pr(14, "T4", "merged", NOW - 2 * DAY)].map((p) => [`o/r#${p.number}`, p])
          ),
          checks: new Map(),
          issues: new Map(),
          rules: new Map(),
          releases: new Map([["o/r", [release("v1", NOW - 2 * DAY, [14]), release("v2", NOW - DAY, [13])]]]),
        },
      }
    )
    const groups = taskGroups(state, "everything", NOW)
    expect(groups.map((g) => [g.head, g.tasks.map((t) => t.id)])).toEqual([
      [{ kind: "ask", ask: askHeads.get(10) }, [1]],
      [{ kind: "next", name: "2026.10.0" }, [2]],
      [{ kind: "release", tag: "v2", at: NOW - DAY }, [3]],
      [{ kind: "release", tag: "v1", at: NOW - 2 * DAY }, [4]],
      [{ kind: "cancelled" }, [5]],
    ])
    expect(taskGroups(state, "doing", NOW).flatMap((g) => g.tasks.map((t) => t.id))).toEqual([1])
    expect(viewCounts(state, NOW, 0, new Set())).toEqual({ everything: 5, needs: 0, doing: 1, review: 0, done: 4 })
    expect(taskGroups({ ...state, facts: new Map() }, "done", NOW)[0]?.head).toEqual({ kind: "next", name: null })
  })
})
