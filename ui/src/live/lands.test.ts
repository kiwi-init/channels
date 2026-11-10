import { describe, expect, test } from "bun:test"

import type { Event, Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { isOpen } from "~/needs/open"
import { asksOf, tasksOf } from "~/live/map"
import { stageWords } from "~/now"

const HEAD = "1".repeat(40)

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
  { name: "mac", pk: "pk-mac", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

const event = (seq: number, from: string, ev: Event): Wire => ({ v: 1, id: `e${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "event", body: "", ev, ts: seq * 1000, rts: seq * 1000 }) as Wire

const TASK = 4

const opened = (seq: number): Wire => event(seq, "jow", { op: "github", items: [{ event: "pull_request", repo: "o/r", number: 7, state: "open", branch: `T${TASK}-x`, sha: HEAD, at: seq * 1000 }] })

const merged = (seq: number): Wire =>
  event(seq, "jow", {
    op: "github",
    items: [{ event: "pull_request", repo: "o/r", number: 7, state: "closed", merged: true, merge: "9".repeat(40), branch: `T${TASK}-x`, sha: HEAD, happened: seq * 1000 - 500, at: seq * 1000 }],
  })

function channel(then: "merge" | "release:tag"): Wire[] {
  return [
    event(1, "jow", { op: "branch.prefix.set", prefix: "T" }),
    event(2, "jow", { op: "landing.set", then }),
    event(3, "jow", { op: "merges.set", by: "people" }),
    event(TASK, "jow", { op: "task.add", title: "export", owner: "win", review: "mac" }),
    opened(5),
  ]
}

const review = (seq: number): Wire => event(seq, "win", { op: "task.update", task: TASK, state: "review", at: HEAD })
const approve = (seq: number): Wire => event(seq, "mac", { op: "task.update", task: TASK, state: "done", verdict: "approved", round: 1, at: HEAD })

const shown = (wires: Wire[]) => tasksOf(fold(wires, roster, 0), new Set(), "jow", wires).find((t) => t.id === TASK)

describe("a task shows how it lands by its steps (#3930 §5)", () => {
  test("an approved task names its steps, its lander and the step it waits for", () => {
    const task = shown([...channel("release:tag"), review(6), approve(7)])
    expect(task?.status).toBe("landing")
    expect(task?.lands).toEqual({ then: "merge → release", by: "win", waits: "waits for step s1 “merge”, win's" })
  })

  test("the old who-merges setting changes nothing: no ready-to-merge label", () => {
    const task = shown([...channel("merge"), review(6), approve(7)])
    expect(Object.keys(task?.lands ?? {}).sort()).toEqual(["by", "then", "waits"])
    expect(task && stageWords(task).text).not.toContain("ready for a person")
  })

  test("a PR merged before its approval puts no card in Needs you, and the task stays in its state", () => {
    const wires = [...channel("merge"), review(6), merged(7)]
    const state = fold(wires, roster, 0)
    const { asks } = asksOf(state, wires, "jow")
    expect(asks.filter(isOpen)).toEqual([])
    expect(shown(wires)?.status).toBe("review")
    const after = [...wires, approve(8)]
    expect(shown(after)?.status).toBe("landing")
    expect(asksOf(fold(after, roster, 0), after, "jow").asks.filter(isOpen)).toEqual([])
  })

  test("a task with no steps shows no landing line", () => {
    const wires = [event(1, "jow", { op: "branch.prefix.set", prefix: "T" }), event(TASK, "jow", { op: "task.add", title: "export", owner: "win", review: "mac" })]
    expect(shown(wires)?.lands).toBeUndefined()
  })
})
