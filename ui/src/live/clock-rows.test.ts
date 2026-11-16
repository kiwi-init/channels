import { describe, expect, test } from "bun:test"

import type { Event, Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { messagesOf } from "~/live/map"
import { wordsRaw } from "~/words"

const HEAD = "1".repeat(40)
const N = 20 * 60_000
const TASK = 2
const EPOCH = 3
const SINCE = 3000

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "owl", pk: "pk-owl", owner: false, at: 0, active: true, kind: "agent", role: "lead", runs: { harness: "claude" } },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
  { name: "mac", pk: "pk-mac", owner: false, at: 0, active: true, kind: "agent", display: "Mac Reviewer", runs: { harness: "claude" } },
]

const at = (seq: number, from: string, ev: Event, ts: number): Wire => ({ v: 1, id: `e${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "event", body: "", ev, ts, rts: ts }) as Wire

const log: Wire[] = [
  at(1, "jow", { op: "landing.set", then: "merge" }, 1000),
  at(TASK, "jow", { op: "task.add", title: "export", owner: "win", review: "owl" }, 2000),
  at(EPOCH, "win", { op: "task.update", task: TASK, state: "review", at: HEAD }, SINCE),
  at(4, "mac", { op: "task.nudge", task: TASK, mover: "owl", since: EPOCH, step: 2, wake: "none" }, SINCE + N),
]

const pictures = { get: () => ({ spot: "", alt: "", state: "waiting" as const }) }
const text = (seq: number): string | undefined => {
  const row = messagesOf(fold(log, roster, SINCE + N), log, "jow", new Map(), pictures, []).find((m) => m.seq === seq)
  return row ? wordsRaw(row.text) : undefined
}

describe("a clock mark reads as Kiwi's clock, naming its seat only as the poster (#2490)", () => {
  test("the row starts with the clock, not the seat, and says whose daemon posted it", () => {
    expect(text(4)).toBe("Kiwi clock: T2 “export” quiet with owl, with no wake attempted: due to the lead (posted by Mac Reviewer's daemon)")
  })

  test("a seat's own act still starts with the seat", () => {
    expect(text(EPOCH)).toStartWith("win ")
  })
})
