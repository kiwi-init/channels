import { describe, expect, test } from "bun:test"

import type { Event, Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, handedOver, type Roster } from "@kiwi/core/state.ts"
import { asksOf } from "~/live/map"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "lead", pk: "pk-lead", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
  { name: "spare", pk: "pk-spare", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
  { name: "dev", pk: "pk-dev", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
  { name: "bo", pk: "pk-bo", owner: false, at: 0, active: true, kind: "human", display: "Bo" },
]

const wire = (seq: number, from: string, more: Partial<Wire>): Wire => ({ v: 1, id: `w${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "msg", body: "", ts: seq * 1000, ...more }) as Wire
const ev = (seq: number, from: string, e: Event): Wire => wire(seq, from, { kind: "event", ev: e })
const reply = (seq: number, from: string, to: number, body: string): Wire => wire(seq, from, { body, re: [to], to: ["dev"] })

const setup = [ev(1, "jow", { op: "role.set", member: "lead", role: "lead" }), ev(2, "jow", { op: "lead.standby", name: "spare", on: true })]
const decision = wire(3, "dev", { kind: "blocking", body: handedOver("dev", "Which database?", {}), to: ["lead"] })
const handover = ev(4, "lead", { op: "lead.duty", to: "spare", from: 0, checkpoint: "#3 and #4 are open." })

const cardFor = (wires: Wire[], me: string) => asksOf(fold(wires, roster, 100_000), wires, me, me === "jow", [], roster, new Map()).asks.find((a) => a.id === String(decision.seq))

describe("the app's card for a decision handed to the Lead follows the duty", () => {
  test("after a handover the lead on duty has the pending card and the former lead has none", () => {
    const wires = [...setup, decision, handover]
    expect(cardFor(wires, "spare")).toMatchObject({ kind: "question", from: "dev" })
    expect(cardFor(wires, "spare")).not.toHaveProperty("answer")
    expect(cardFor(wires, "lead")).toBeUndefined()
  })

  test("the settled card shows the accepted answer, not the former lead's stale reply or a later one", () => {
    const wires = [...setup, decision, handover, reply(5, "lead", 3, "postgres"), reply(6, "spare", 3, "sqlite"), reply(7, "spare", 3, "on second thought, postgres")]
    expect(cardFor(wires, "spare")).toMatchObject({ answer: { by: "spare", seq: 6 } })
    expect(cardFor(wires, "lead")).toBeUndefined()
  })

  test("an answer before the handover stays the answer, on the card of the lead on duty", () => {
    const wires = [...setup, decision, reply(4, "lead", 3, "postgres"), ev(5, "lead", { op: "lead.duty", to: "spare", from: 0, checkpoint: "#3 and #4 are open." }), reply(6, "spare", 3, "sqlite")]
    expect(cardFor(wires, "spare")).toMatchObject({ answer: { by: "lead", seq: 4 } })
  })
})

describe("the app's card for an ask the lead put to a person keeps the accepted answer", () => {
  test("an answer accepted under a power is still the card's answer after the power is taken back", () => {
    const grant = ev(3, "jow", { op: "power.set", member: "bo", pk: "pk-bo", was: false, power: "answersDecisions", on: true })
    const ask = wire(4, "lead", { kind: "ask", body: "Ship 2.0 today?", to: ["jow"], esc: true })
    const out = ev(5, "lead", { op: "lead.duty", to: "spare", from: 0, checkpoint: "#3 and #4 are open." })
    const answer = wire(6, "bo", { body: "yes", re: [4], to: ["lead"] })
    const revoke = ev(7, "jow", { op: "power.set", member: "bo", pk: "pk-bo", was: true, power: "answersDecisions", on: false })
    const wires = [...setup, grant, ask, out, answer, revoke]
    const card = asksOf(fold(wires, roster, 100_000), wires, "jow", true, [], roster, new Map()).asks.find((a) => a.id === "4")
    expect(card).toMatchObject({ kind: "question", answer: { by: "bo", seq: 6 } })
  })
})

describe("tap-to-answer doesn't rewrite a lead ask's card", () => {
  const ask = wire(3, "lead", { kind: "ask", body: "Ship 2.0 today?", to: ["jow"], esc: true })
  const out = ev(4, "lead", { op: "lead.duty", to: "spare", from: 0, checkpoint: "#3 and #4 are open." })
  const cardOf = (wires: Wire[]) => asksOf(fold(wires, roster, 100_000), wires, "jow", true, [], roster, new Map()).asks.find((a) => a.id === "3")

  test("an answer typed before tap-only was turned on stays the settled answer after it", () => {
    const typed = wire(5, "jow", { body: "yes", re: [3], to: ["lead"] })
    const tap = ev(6, "jow", { op: "asks.tap.set", on: true })
    const wires = [...setup, ask, out, typed, tap]
    expect(fold(wires, roster, 100_000).leadOwned.get(3)?.answer).toEqual({ by: "jow", seq: 5, to: "spare" })
    expect(cardOf(wires)).toMatchObject({ answer: { by: "jow", seq: 5 } })
    expect(cardOf(wires)).not.toHaveProperty("typed")
  })

  test("with tap-only on first, my typed reply leaves the card pending and stays my typed hint after someone else replies", () => {
    const tap = ev(5, "jow", { op: "asks.tap.set", on: true })
    const typed = wire(6, "jow", { body: "yes", re: [3], to: ["lead"] })
    const aside = wire(7, "dev", { body: "fwiw the build is green", re: [3], to: ["lead"] })
    const wires = [...setup, ask, out, tap, typed, aside]
    expect(fold(wires, roster, 100_000).leadOwned.get(3)?.answer).toBeUndefined()
    const card = cardOf(wires)
    expect(card).not.toHaveProperty("answer")
    expect(card).toMatchObject({ typed: { by: "jow", seq: 6 } })
  })
})
