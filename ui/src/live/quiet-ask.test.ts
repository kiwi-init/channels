import { describe, expect, test } from "bun:test"

import type { Event, Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { homeOf } from "~/home"
import { asksOf } from "~/live/map"
import type { Ask, Channel } from "~/model"
import { isOpen } from "~/needs/open"

const HEAD = "1".repeat(40)
const MIN = 60_000
const N = 20 * MIN
const TASK = 2
const EPOCH = 3
const SINCE = 3000

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "owl", pk: "pk-owl", owner: false, at: 0, active: true, kind: "agent", role: "lead", runs: { harness: "claude" } },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
  { name: "mac", pk: "pk-mac", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

const at = (seq: number, from: string, ev: Event, ts: number): Wire => ({ v: 1, id: `e${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "event", body: "", ev, ts, rts: ts }) as Wire

const inReview = (): Wire[] => [
  at(1, "jow", { op: "landing.set", then: "merge" }, 1000),
  at(TASK, "jow", { op: "task.add", title: "export", owner: "win", review: "mac" }, 2000),
  at(EPOCH, "win", { op: "task.update", task: TASK, state: "review", at: HEAD }, SINCE),
]

const nudge = (seq: number, from: string, step: 1 | 2 | 3, ts: number, wake?: "none" | "attempted" | "delivered" | "read"): Wire =>
  at(seq, from, { op: "task.nudge", task: TASK, mover: "mac", since: EPOCH, step, ...(wake ? { wake } : {}) }, ts)

const quiet = (wires: Wire[], now: number, me = "jow"): Ask[] => {
  const state = fold(wires, roster, now)
  return asksOf(state, wires, me, me === "jow", [], [], new Map(), now).asks.filter((a) => a.kind === "quiet")
}

describe("a task quiet past 3N is one item in the owner's Needs you (#3930 §2)", () => {
  test("step 3 with no wake attempted: one open item naming the task, its mover and that no wake was attempted", () => {
    const wires = [...inReview(), nudge(4, "owl", 2, SINCE + N, "none"), nudge(5, "owl", 3, SINCE + 3 * N)]
    const now = SINCE + 3 * N + MIN
    const state = fold(wires, roster, now)
    expect(state.rejected.size).toBe(0)
    const asks = quiet(wires, now)
    expect(asks).toEqual([{ kind: "quiet", id: `quiet-${TASK}-${EPOCH}`, at: SINCE + 3 * N, from: "mac", task: TASK, since: SINCE, wake: { kind: "none" } }])
    expect(asks.every(isOpen)).toBe(true)
  })

  test("the item says what is recorded about the wake: attempted, delivered, read", () => {
    const woken = [...inReview(), nudge(4, "mac", 1, SINCE + N)]
    const delivered = at(5, "mac", { op: "task.wake", task: TASK, mover: "mac", since: EPOCH, got: "delivered" }, SINCE + N + 1000)
    const read = at(6, "mac", { op: "task.wake", task: TASK, mover: "mac", since: EPOCH, got: "read" }, SINCE + N + 2000)
    const top = (seq: number) => nudge(seq, "owl", 3, SINCE + 3 * N)
    const now = SINCE + 3 * N + MIN
    expect(quiet([...woken, top(5)], now).map((a) => a.kind === "quiet" && a.wake)).toEqual([{ kind: "attempted", at: SINCE + N }])
    expect(quiet([...woken, delivered, top(6)], now).map((a) => a.kind === "quiet" && a.wake)).toEqual([{ kind: "delivered", at: SINCE + N }])
    expect(quiet([...woken, delivered, read, top(7)], now).map((a) => a.kind === "quiet" && a.wake)).toEqual([{ kind: "read", at: SINCE + N }])
  })

  test("below step 3 there is no item, and only the owner gets one", () => {
    const two = [...inReview(), nudge(4, "owl", 2, SINCE + N, "none")]
    expect(quiet(two, SINCE + 2 * N)).toEqual([])
    const three = [...two, nudge(5, "owl", 3, SINCE + 3 * N)]
    expect(quiet(three, SINCE + 3 * N + MIN)).toHaveLength(1)
    expect(quiet(three, SINCE + 3 * N + MIN, "owl")).toEqual([])
  })

  test("the item goes when the mover acts, because that starts a new clock", () => {
    const three = [...inReview(), nudge(4, "owl", 2, SINCE + N, "none"), nudge(5, "owl", 3, SINCE + 3 * N)]
    const spoke = SINCE + 3 * N + 2 * MIN
    const acted = { v: 1, id: "m6", seq: 6, from: "mac", pk: "pk-mac", sigOk: true, kind: "msg", body: "reading it now", task: TASK, ts: spoke, rts: spoke } as Wire
    expect(quiet([...three, acted], SINCE + 3 * N + 3 * MIN)).toEqual([])
  })

  test("Home lists it as something to open", () => {
    const wires = [...inReview(), nudge(4, "owl", 2, SINCE + N, "none"), nudge(5, "owl", 3, SINCE + 3 * N)]
    const asks = quiet(wires, SINCE + 3 * N + MIN)
    const channel = { you: "jow", youOwn: true, asks, tasks: [], people: [], nicknames: new Map(), specs: [] } as unknown as Channel
    const home = homeOf(channel)
    expect(home.asks.map((a) => [a.what, a.act.kind])).toEqual([["T2 is quiet with mac", "open"]])
  })
})
