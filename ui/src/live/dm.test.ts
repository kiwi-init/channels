import { describe, expect, test } from "bun:test"
import type { ChannelState } from "@kiwi/core/state.ts"
import { sendsInTurn } from "@kiwi/app/send-order.ts"
import { dmInRoom, dmRoomOf, dmsOnce } from "~/live/dm"
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
const person = (name: string, more: Partial<Person> = {}): Person => ({ name, kind: "human", owner: false, you: false, presence: "online", ...more })

describe("a DM with a person is a members-only room of the two of them (T703)", () => {
  test("the DM room is found by person, whichever device writes, and a group room never counts", () => {
    const s = state([room("group", ["jow", "tia"], false), room("ours", ["jow", "jow-2", "tia"])])
    expect([dmRoomOf(s, "jow", "tia"), dmRoomOf(s, "jow-2", "tia"), dmRoomOf(s, "jow", "ana")]).toEqual(["ours", "ours", undefined])
  })

  test("a DM with a person goes in a room of its own; a DM with an agent stays a thread", () => {
    const people = [person("jow", { you: true }), person("tia"), person("ana", { kind: "agent" })]
    expect([dmInRoom({ people }, "tia"), dmInRoom({ people }, "ana"), dmInRoom({ people }, "nobody")]).toEqual([true, false, false])
  })
})

describe("two quick first DMs to someone share one DM room (T1479)", () => {
  const tick = () => new Promise((done) => setTimeout(done, 1))

  test("a second Enter before the first room lands, in turn or at once, reuses the room being made", async () => {
    const once = dmsOnce()
    const inTurn = sendsInTurn()
    const made: string[] = []
    const make = async () => {
      await tick()
      made.push(`dm${made.length + 1}`)
      return made.at(-1)
    }
    const [a, b] = await Promise.all([inTurn(() => once("tia", make)), inTurn(() => once("tia", make))])
    const [c, d] = await Promise.all([once("tia", make), once("tia", make)])
    const other = await once("ana", make)
    expect([a, b, c, d, other, made]).toEqual(["dm1", "dm1", "dm1", "dm1", "dm2", ["dm1", "dm2"]])
  })

  test("a try that made no room, or failed, is tried again on the next message", async () => {
    const once = dmsOnce()
    expect(await once("tia", async () => undefined)).toBeUndefined()
    await expect(once("tia", async () => Promise.reject(new Error("offline")))).rejects.toThrow("offline")
    await tick()
    expect(await once("tia", async () => "ours")).toBe("ours")
  })
})
