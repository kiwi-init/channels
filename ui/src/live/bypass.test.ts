import { describe, expect, test } from "bun:test"

import type { Event, Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { isOpen } from "~/needs/open"
import { asksOf, tasksOf } from "~/live/map"

const HEAD = "1".repeat(40)

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
  { name: "mac", pk: "pk-mac", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

const event = (seq: number, from: string, ev: Event): Wire => ({ v: 1, id: `e${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "event", body: "", ev, ts: seq * 1000, rts: seq * 1000 }) as Wire

function mergedBeforeApproval(): Wire[] {
  const task = 3
  return [
    event(1, "jow", { op: "branch.prefix.set", prefix: "T" }),
    event(2, "jow", { op: "landing.set", then: "merge" }),
    event(task, "jow", { op: "task.add", title: "export", owner: "win", review: "mac" }),
    event(4, "win", { op: "task.update", task, state: "review", at: HEAD }),
    event(5, "jow", {
      op: "github",
      items: [{ event: "pull_request", repo: "o/r", number: 7, state: "closed", merged: true, merge: "9".repeat(40), branch: `T${task}-x`, sha: HEAD, happened: 4500, at: 5000 }],
    }),
  ]
}

describe("a merge while the ship gate was shut reaches the owner (#623 §5)", () => {
  test("the owner gets a bypass card in Needs you, and the board marks the task", () => {
    const wires = mergedBeforeApproval()
    const state = fold(wires, roster, 0)
    const { asks } = asksOf(state, wires, "jow", true, [], roster, new Map())
    const card = asks.find((a) => a.kind === "bypass")
    expect(card).toMatchObject({ kind: "bypass", task: 3, from: "win", missing: ["an approval before the merge"] })
    expect(card && isOpen(card)).toBe(true)
    const task = tasksOf(state, new Set(), "jow", wires).find((t) => t.id === 3)
    expect(task?.lands?.bypassed).toEqual(["an approval before the merge"])
  })

  test("an agent doesn't get the card", () => {
    const wires = mergedBeforeApproval()
    const { asks } = asksOf(fold(wires, roster, 0), wires, "win", false, [], roster, new Map())
    expect(asks.some((a) => a.kind === "bypass")).toBe(false)
  })
})
