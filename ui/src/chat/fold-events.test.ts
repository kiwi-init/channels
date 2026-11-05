import { describe, expect, test } from "bun:test"
import type { GithubNote } from "@kiwi/core/protocol.ts"
import { githubSummary, linesOf, splitUpdates } from "~/chat/fold-events"
import type { Message, Task } from "~/model"

const general = { kind: "room", room: "general" } as const
const day = new Date(2026, 9, 29, 10).getTime()
const msg = (seq: number, extra: Partial<Message> = {}): Message => ({ seq, from: "atlas", at: day + seq * 60_000, text: `message ${seq}`, where: general, ...extra })
const ev = (seq: number, extra: Partial<Message> = {}): Message => msg(seq, { system: true, text: `event ${seq}`, ...extra })
const task = (id: number, extra: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  status: "doing",
  createdBy: "jow",
  createdAt: 0,
  updatedAt: 0,
  notes: [],
  rounds: [],
  history: [],
  archived: false,
  ...extra,
})
const tasks = (...list: Task[]): ReadonlyMap<number, Task> => new Map(list.map((t) => [t.id, t]))
const pr = (number: number, action: string, extra: Partial<GithubNote> = {}): GithubNote => ({
  event: "pull_request",
  repo: "kiwi-init/channels",
  number,
  action,
  url: `https://github.com/kiwi-init/channels/pull/${number}`,
  ...extra,
})

describe("updates leave the thread", () => {
  test("task events, joins, room creation and GitHub rows go to the panel; messages, asks and left-out rows stay", () => {
    const list = [
      msg(1),
      ev(2, { text: "T12 done", task: 12 }),
      ev(3, { text: "lucid-marmot joined" }),
      msg(4, { ask: "which one, A or B?" }),
      ev(5, { text: "room #ops created" }),
      ev(6, { leftOut: "Refused: read only" }),
      ev(7, { github: [pr(9, "opened")] }),
      msg(8),
    ]
    const { talk, runs } = splitUpdates(list)
    expect(talk.map((m) => m.seq)).toEqual([1, 4, 6, 8])
    expect(runs.map((r) => r.map((m) => m.seq))).toEqual([[2, 3], [5], [7]])
  })

  test("a run is the updates between two messages on one day, so each folds on its own", () => {
    const next = day + 86_400_000
    const { runs } = splitUpdates([ev(1), ev(2), msg(3), ev(4), ev(5, { at: next }), ev(6, { at: next + 60_000 })])
    expect(runs.map((r) => r.map((m) => m.seq))).toEqual([[1, 2], [4], [5, 6]])
  })
})

describe("folding a run into lines", () => {
  test("one or two plain events stay their own lines", () => {
    expect(linesOf([ev(1), ev(2)], tasks()).map((l) => l.kind)).toEqual(["one", "one"])
  })

  test("three or more plain events fold into one line", () => {
    const lines = linesOf([ev(1), ev(2), ev(3)], tasks())
    expect(lines).toHaveLength(1)
    expect(lines[0]?.kind === "events" && lines[0].list.length).toBe(3)
  })

  test("every task event folds into one line, grouped by task", () => {
    const lines = linesOf([ev(1, { task: 12 }), ev(2), ev(3, { task: 18 }), ev(4, { task: 12 })], tasks(task(12), task(18)))
    expect(lines.map((l) => l.kind)).toEqual(["tasks", "one"])
    const work = lines[0]
    expect(work?.kind === "tasks" && work.tasks.map((t) => [t.id, t.list.map((m) => m.seq)])).toEqual([
      [12, [1, 4]],
      [18, [3]],
    ])
  })

  test("one task update is just its line", () => {
    expect(linesOf([ev(1, { task: 12 })], tasks(task(12))).map((l) => l.kind)).toEqual(["one"])
  })

  test("an event for you, or on a task waiting on you, stays its own line", () => {
    const lines = linesOf([ev(1, { task: 12 }), ev(2, { task: 14 }), ev(3, { mentionsYou: true }), ev(4, { task: 18 })], tasks(task(12), task(14, { youReview: "verdict" }), task(18)))
    expect(lines.map((l) => (l.kind === "one" ? l.m.seq : l.kind))).toEqual(["tasks", 2, 3])
  })

  test("a task waiting on you keeps one line, its latest event", () => {
    const lines = linesOf([ev(1, { task: 14 }), ev(2, { task: 12 }), ev(3, { task: 14 })], tasks(task(12), task(14, { youReview: "verdict" })))
    expect(lines.map((l) => (l.kind === "one" ? l.m.seq : l.kind))).toEqual([3, 2])
  })

  test("an event on a task the channel no longer has is a plain event", () => {
    expect(linesOf([ev(1, { task: 99 })], tasks()).map((l) => l.kind)).toEqual(["one"])
  })

  test("GitHub's news folds into one linked line", () => {
    const lines = linesOf(
      [
        ev(1, { github: [pr(371, "opened")] }),
        ev(2, { github: [{ event: "push", at: 0, repo: "kiwi-init/channels" }] }),
        ev(3, { github: [{ event: "check_run", at: 0, repo: "kiwi-init/channels", name: "ci-ok" }] }),
        ev(4, { github: [{ event: "check_run", at: 0, repo: "kiwi-init/channels", name: "ci-ok", conclusion: "success" }] }),
      ],
      tasks()
    )
    expect(lines).toHaveLength(1)
    const gh = lines[0]
    expect(gh?.kind).toBe("github")
    if (gh?.kind !== "github") return
    expect(gh.updates).toBe(3)
    expect(gh.parts).toEqual([{ ref: "#371", url: "https://github.com/kiwi-init/channels/pull/371", text: "opened" }, { text: "1 push" }, { text: "ci-ok passed" }])
  })
})

describe("GitHub summary", () => {
  test("a PR's last word wins, a merge says merged and synchronize counts as a push", () => {
    expect(githubSummary([pr(5, "opened"), pr(5, "synchronize"), pr(5, "closed", { merged: true }), { event: "issues", at: 0, repo: "r/r", number: 9, action: "closed" }])).toEqual([
      { ref: "#5", url: "https://github.com/kiwi-init/channels/pull/5", text: "merged" },
      { ref: "issue #9", text: "closed" },
      { text: "1 push" },
    ])
  })

  test("failed checks say failed", () => {
    expect(githubSummary([{ event: "workflow_run", at: 0, repo: "r/r", name: "ci", conclusion: "timed_out" }])).toEqual([{ text: "ci failed" }])
  })
})
