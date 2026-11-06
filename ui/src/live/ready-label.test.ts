import { describe, expect, test } from "bun:test"

import type { Event, Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { tasksOf } from "~/live/map"
import { stageWords } from "~/now"

const HEAD = "1".repeat(40)

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
  { name: "mac", pk: "pk-mac", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

const event = (seq: number, from: string, ev: Event): Wire => ({ v: 1, id: `e${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "event", body: "", ev, ts: seq * 1000, rts: seq * 1000 }) as Wire

function approved(by: "people" | "agents"): Wire[] {
  const task = 4
  return [
    event(1, "jow", { op: "branch.prefix.set", prefix: "T" }),
    event(2, "jow", { op: "landing.set", then: "merge" }),
    event(3, "jow", { op: "merges.set", by }),
    event(task, "jow", { op: "task.add", title: "export", owner: "win", review: "mac" }),
    event(5, "jow", { op: "github", items: [{ event: "pull_request", repo: "o/r", number: 7, state: "open", branch: `T${task}-x`, sha: HEAD, at: 5000 }] }),
    event(6, "win", { op: "task.update", task, state: "review", at: HEAD }),
    event(7, "mac", { op: "task.update", task, state: "done", verdict: "approved", round: 1, at: HEAD }),
  ]
}

describe("the board says when a PR is ready for a person to merge (#623 §6, T1142)", () => {
  test("with people merging and the gate open, the task is marked ready and the board says so", () => {
    const wires = approved("people")
    const task = tasksOf(fold(wires, roster, 0), new Set(), "jow", wires).find((t) => t.id === 4)
    expect(task?.lands?.ready).toBe(true)
    expect(task?.lands?.waits).toBe("is ready for a person to merge PR #7")
    expect(task && stageWords(task).text).toContain("ready for a person to merge")
  })

  test("with agents merging, there's no such label", () => {
    const wires = approved("agents")
    const task = tasksOf(fold(wires, roster, 0), new Set(), "jow", wires).find((t) => t.id === 4)
    expect(task?.lands?.ready).toBeUndefined()
  })
})
