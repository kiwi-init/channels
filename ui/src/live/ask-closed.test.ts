import { describe, expect, test } from "bun:test"

import type { Event, Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { isOpen, openAsks } from "~/needs/open"
import { asksOf } from "~/live/map"
import { wordsRaw } from "~/words"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
  { name: "mac", pk: "pk-mac", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

const ask = (seq: number, from = "win"): Wire =>
  ({ v: 1, id: `q${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "blocking", body: "Merge A or B? Approve?", ts: seq * 1000, to: ["jow"], esc: true, choices: ["A", "B"] }) as Wire

const close = (seq: number, n: number, from = "win", why?: string): Wire =>
  ({
    v: 1,
    id: `c${seq}`,
    seq,
    from,
    pk: `pk-${from}`,
    sigOk: true,
    kind: "event",
    body: `closed #${n}`,
    ev: { op: "ask.close", ask: n, ...(why ? { why } : {}) } satisfies Event,
    re: [n],
    ts: seq * 1000,
  }) as Wire

const asksFor = (wires: Wire[]) => asksOf(fold(wires, roster, 0), wires, "jow", true, [], roster, new Map())

describe("a closed ask keeps its card, saying it was closed (#1575)", () => {
  test("the asker's close gives the question a closed state with who, when and why, and no longer a pending one", () => {
    const wires = [ask(5), close(6, 5, "win", "Superseded by #7, which has the corrected options"), ask(7)]
    const { asks, askOf } = asksFor(wires)
    expect(askOf.get(5)).toBe("5")
    const closed = asks.find((a) => a.id === "5")
    expect(closed).toMatchObject({ kind: "question", closed: { by: "win", at: 6000 } })
    expect(closed?.kind === "question" && closed.closed?.why && wordsRaw(closed.closed.why)).toBe("Superseded by #7, which has the corrected options")
    expect(closed && isOpen(closed)).toBe(false)
    expect(openAsks({ asks }).map((a) => a.id)).not.toContain("5")
    expect(asks.find((a) => a.id === "7")).not.toHaveProperty("closed")
  })

  test("a close with no reason still shows as closed", () => {
    const { asks } = asksFor([ask(5), close(6, 5)])
    expect(asks.find((a) => a.id === "5")).toMatchObject({ closed: { by: "win", at: 6000 } })
    expect(asks.find((a) => a.id === "5")).not.toHaveProperty("closed.why")
  })

  test("a close the fold refused, from someone who didn't ask, leaves the ask open", () => {
    const { asks } = asksFor([ask(5), close(6, 5, "mac")])
    const still = asks.find((a) => a.id === "5")
    expect(still).not.toHaveProperty("closed")
    expect(still && isOpen(still)).toBe(true)
  })
})
