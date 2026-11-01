import { describe, expect, test } from "bun:test"
import type { ChannelState } from "@kiwi/core/state.ts"
import { leaversToSeal, leftRoom } from "~/live/leaving"

const seat = (name: string, handle: string) => [name, { name, pk: `pk-${name}`, kind: "human", active: true, owner: false, sponsor: { user: `p-${handle}`, name: handle, handle } }] as const
const members = new Map([seat("lia", "lia"), seat("lia-2", "lia"), seat("mo", "mo"), seat("out", "out")])
const room = { n: 1, seals: [], meta: { name: "ops", members: ["lia", "lia-2", "mo"].map((name) => ({ name, pk: `pk-${name}` })) }, leaving: ["lia"] }
const state = { members, secret: new Map([["ops", room]]) } as unknown as Pick<ChannelState, "secret" | "members">

describe("leaving a private room (T1768)", () => {
  test("the room is gone for the person leaving, on any of their devices", () => {
    expect(leftRoom(state, "ops", "lia")).toBe(true)
    expect(leftRoom(state, "ops", "lia-2")).toBe(true)
    expect(leftRoom(state, "ops", "mo")).toBe(false)
  })

  test("a member still in seals out every device of the person leaving", () => {
    expect(leaversToSeal(state, "mo")).toEqual([{ id: "ops", names: ["lia", "lia-2"] }])
  })

  test("the leaver and people outside the room have nothing to do", () => {
    expect(leaversToSeal(state, "lia")).toEqual([])
    expect(leaversToSeal(state, "lia-2")).toEqual([])
    expect(leaversToSeal(state, "out")).toEqual([])
  })
})
