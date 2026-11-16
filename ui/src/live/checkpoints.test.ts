import { describe, expect, test } from "bun:test"

import type { Event, Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { checkpointRoundOf } from "~/live/checkpoints"

const roster: Roster = [
  { name: "jon", pk: "pk-jon", owner: true, at: 0, active: true, kind: "human" },
  { name: "owl", pk: "pk-owl", owner: false, at: 1, active: true, kind: "agent", role: "lead" },
  { name: "win", pk: "pk-win", owner: false, at: 2, active: true, kind: "agent" },
  { name: "fox", pk: "pk-fox", owner: false, at: 3, active: true, kind: "agent" },
]

let seq = 0
const ev = (from: string, e: Event): Wire => {
  seq++
  return { v: 1, id: `m${seq}`, from, kind: "event", body: "", ts: seq, ev: e, seq, rts: seq, sigOk: true, pk: `pk-${from}` } as Wire
}

describe("the latest checkpoint request, as the Agents view shows it", () => {
  test("none asked yet: nothing to show", () => {
    expect(checkpointRoundOf(fold([], roster))).toBeUndefined()
  })

  test("each agent is saved, waiting on what it still owes, or unreachable", () => {
    const a = ev("jon", { op: "task.add", title: "One", owner: "win" })
    const b = ev("jon", { op: "task.add", title: "Two", owner: "win" })
    const ask = ev("jon", {
      op: "checkpoint.ask",
      asks: [
        { agent: "owl", tasks: [], lead: true },
        { agent: "win", tasks: [a.seq, b.seq] },
      ],
      unreachable: ["fox"],
    })
    const saved = ev("win", { op: "task.update", task: a.seq, note: "where it stands", checkpoint: true })
    const round = checkpointRoundOf(fold([a, b, ask, saved], roster))
    expect(round).toEqual({
      seq: ask.seq,
      at: ask.rts!,
      daily: false,
      agents: [
        { name: "owl", state: "pending", tasks: [], lead: true },
        { name: "win", state: "pending", tasks: [b.seq], lead: false },
        { name: "fox", state: "unreachable" },
      ],
    })
    const done = checkpointRoundOf(fold([a, b, ask, saved, ev("win", { op: "task.update", task: b.seq, note: "the rest", checkpoint: true })], roster))
    expect(done?.agents.find((x) => x.name === "win")).toEqual({ name: "win", state: "saved" })
  })
})
