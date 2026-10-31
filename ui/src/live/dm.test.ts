import { describe, expect, test } from "bun:test"
import { PRIVATE_DM_OPS } from "@kiwi/core/protocol.ts"
import type { ChannelState } from "@kiwi/core/state.ts"
import { dmBlocker, dmRoomOf, sealable } from "~/live/dm"
import type { Person } from "~/model"

type Seat = { name: string; pk: string; kind: "human" | "agent"; active: boolean; owner: boolean; sponsor?: { user: string; name: string; handle: string } }
const seat = (name: string, more: Partial<Seat> = {}): [string, Seat] => [name, { name, pk: `pk-${name}`, kind: "human", active: true, owner: false, ...more }]
const members = new Map([
  seat("jow", { owner: true }),
  seat("jow-2", { sponsor: { user: "p-jow", name: "jow", handle: "jow" } }),
  seat("tia", { sponsor: { user: "p-tia", name: "tia", handle: "tia" } }),
  seat("ana", { kind: "agent" }),
])
const room = (id: string, names: string[], dm = true) =>
  [id, { id, name: "", createdBy: null, at: 0, members: names.map((n) => ({ name: n, pk: `pk-${n}` })), ...(dm ? { dm: true as const } : {}) }] as const
const state = (rooms: ReturnType<typeof room>[]) => ({ members, rooms: new Map(rooms) }) as unknown as Pick<ChannelState, "rooms" | "members">

const ready = { app: PRIVATE_DM_OPS }
const person = (name: string, more: Partial<Person> = {}): Person => ({ name, kind: "human", owner: false, you: false, presence: "online", ops: ready, ...more })

describe("a DM with a person is sealed when both of them can open it (T1149)", () => {
  test("the DM room is found by person, whichever device writes, and a group room never counts", () => {
    const s = state([room("group", ["jow", "tia"], false), room("ours", ["jow", "jow-2", "tia"])])
    expect([dmRoomOf(s, "jow", "tia"), dmRoomOf(s, "jow-2", "tia"), dmRoomOf(s, "jow", "ana")]).toEqual(["ours", "ours", undefined])
  })

  test("every device of both people must be able to open it; otherwise the note names whose app holds it back", () => {
    const people = [person("jow", { you: true }), person("jow-2", { seatOf: "jow" }), person("tia"), person("ana", { kind: "agent" })]
    expect(sealable({ you: "jow", people }, "tia")).toBe(true)
    expect(dmBlocker({ you: "jow", people: people.map((p) => (p.name === "tia" ? { ...p, ops: { app: PRIVATE_DM_OPS - 1 } } : p)) }, "tia")).toBe("tia's app")
    expect(dmBlocker({ you: "jow", people: people.map((p) => (p.name === "jow-2" ? { ...p, ops: {} } : p)) }, "tia")).toBe("your other device")
    expect(dmBlocker({ you: "jow", people: people.map((p) => (p.name === "jow" ? { ...p, ops: { app: PRIVATE_DM_OPS - 1 } } : p)) }, "tia")).toBe("your app")
  })

  test("a DM with an agent is never sealed", () => {
    const people = [person("jow", { you: true }), person("ana", { kind: "agent" })]
    expect([sealable({ you: "jow", people }, "ana"), dmBlocker({ you: "jow", people }, "ana")]).toEqual([false, null])
  })
})
