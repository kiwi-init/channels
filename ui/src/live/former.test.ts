import { describe, expect, test } from "bun:test"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { formerOf, peopleOf } from "~/live/map"
import { memberOf } from "~/model"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "patient-otter", pk: "pk-otter", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
  { name: "honest-wren", pk: "pk-wren", owner: false, at: 0, active: false, kind: "agent", display: "docs", runs: { harness: "codex" } },
]
const state = fold([], roster, 0)

describe("members who left keep their face in the feed (T369)", () => {
  test("the member list holds only who's here", () => {
    expect(peopleOf(state, roster, new Map(), "jow", new Map()).map((p) => p.name)).toEqual(["jow", "patient-otter"])
  })

  test("a member who left is kept apart, offline, with their harness and nickname", () => {
    const former = formerOf(state, "jow")
    expect(former).toHaveLength(1)
    expect(former[0]).toMatchObject({ name: "honest-wren", kind: "agent", harness: "codex", display: "docs", presence: "offline", left: true })
  })

  test("a message's sender resolves to who's here first, then to who left", () => {
    const channel = { people: peopleOf(state, roster, new Map(), "jow", new Map()), former: formerOf(state, "jow") }
    expect(memberOf(channel, "patient-otter")?.left).toBeUndefined()
    expect(memberOf(channel, "honest-wren")?.left).toBe(true)
    expect(memberOf(channel, "nobody")).toBeUndefined()
  })
})
