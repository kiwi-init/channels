import { describe, expect, test } from "bun:test"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { peopleOf } from "~/live/map"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human" },
  { name: "maya", pk: "pk-maya", owner: false, at: 0, active: true, kind: "human", addsAgents: true, answersDecisions: true },
  { name: "lin", pk: "pk-lin", owner: false, at: 0, active: true, kind: "human" },
  { name: "patient-otter", pk: "pk-otter", owner: false, at: 0, active: true, kind: "agent", addsAgents: true },
]
const people = peopleOf(fold([], roster, 0), roster, new Map(), "jow", new Set())
const by = (name: string) => people.find((p) => p.name === name)

describe("a person's powers show on their profile (T380)", () => {
  test("powers the owner granted are read from the roster", () => {
    expect(by("maya")).toMatchObject({ addsAgents: true, answersDecisions: true })
  })

  test("people without them, and agents, carry none", () => {
    expect(by("lin")?.addsAgents).toBeUndefined()
    expect(by("lin")?.answersDecisions).toBeUndefined()
    expect(by("patient-otter")?.addsAgents).toBeUndefined()
  })
})
