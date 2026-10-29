import { describe, expect, test } from "bun:test"

import { fold, type ChannelState, type GithubCheck, type GithubPr, type GithubRelease, type Task, type TaskState } from "@kiwi/core/state.ts"
import { groupsOf, tasksOf } from "~/live/map"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 28, 15)

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

const pr = (number: number, branch: string, state: GithubPr["state"], at: number, sha?: string): GithubPr => ({ repo: "o/r", number, branch, state, at, seq: number, ...(sha ? { sha } : {}) })
const release = (tag: string, at: number, prs: number[]): GithubRelease => ({ repo: "o/r", tag, at, shas: [], prs, seq: at })
const check = (name: string, conclusion?: string): [string, GithubCheck] => [name, { name, at: NOW, ...(conclusion ? { conclusion } : {}) }]

const base = fold([], [], NOW)
const state: ChannelState = {
  ...base,
  lead: "lead",
  branchPrefix: "T",
  askHeads: new Map([
    [10, { id: 10, by: "jon", words: "  ship v2  ", at: 0, goal: "Ship 2.0" }],
    [20, { id: 20, by: "maya", words: "fix the board", at: 0 }],
  ]),
  tasks: new Map(
    [
      task(1, "doing", NOW, { ask: 10 }),
      task(2, "review", NOW - 5, { ask: 20 }),
      task(3, "todo", NOW - 9, { leftBy: "scout" }),
      task(4, "done", NOW - DAY, { ask: 10 }),
      task(5, "done", NOW - 3, { cancelled: true }),
    ].map((t) => [t.id, t])
  ),
  github: {
    prs: new Map([pr(11, "T1-a", "open", NOW, "abc"), pr(14, "T4-d", "merged", NOW - DAY)].map((p) => [`o/r#${p.number}`, p])),
    checks: new Map([["o/r@abc", new Map([check("lint", "success"), check("unit", "failure"), check("shots")])]]),
    issues: new Map(),
    rules: new Map(),
    releases: new Map([["o/r", [release("v2026.10.9", NOW - DAY, [14])]]]),
  },
}

describe("the board's groups (T611)", () => {
  test("asks carry their goal, words, who and whether you may name it; then unfiled, the release and cancelled", () => {
    expect(groupsOf(state, "jon", NOW)).toEqual([
      { key: "ask:10", tasks: [1], head: { kind: "ask", id: 10, by: "jon", words: "ship v2", goal: "Ship 2.0", mayName: true } },
      { key: "ask:20", tasks: [2], head: { kind: "ask", id: 20, by: "maya", words: "fix the board", mayName: false } },
      { key: "unfiled", tasks: [3], head: { kind: "unfiled" } },
      { key: "release:v2026.10.9", tasks: [4], head: { kind: "release", tag: "2026.10.9", at: NOW - DAY } },
      { key: "cancelled", tasks: [5], head: { kind: "cancelled" } },
    ])
  })

  test("the lead may name any ask's goal", () => {
    expect(groupsOf(state, "lead", NOW).flatMap((g) => (g.head.kind === "ask" ? [g.head.mayName] : []))).toEqual([true, true])
  })

  test("a PR's ticks count passed, running and failed checks; a shipped task names its release; a task left behind says who left", () => {
    const tasks = new Map(tasksOf(state, new Set(), "jon", []).map((t) => [t.id, t]))
    expect(tasks.get(1)?.pr?.ticks).toEqual({ passed: 1, running: 1, failed: ["unit"] })
    expect(tasks.get(4)?.release).toBe("2026.10.9")
    expect(tasks.get(3)?.leftBy).toBe("scout")
    expect(tasks.get(1)?.leftBy).toBeUndefined()
  })
})
