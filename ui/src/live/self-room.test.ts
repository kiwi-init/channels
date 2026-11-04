import { describe, expect, test } from "bun:test"

import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { roomsOf } from "~/live/map"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

let next = 0
const make = (from: string, ev: Record<string, unknown>): Wire => {
  next++
  return { v: 1, id: `w${next}`, seq: next, from, pk: `pk-${from}`, sigOk: true, kind: "event", body: "", ev, ts: next * 1000, rts: next * 1000 } as Wire
}

describe("the room that keeps your read marks never shows as a room (T1299)", () => {
  test("Rooms lists #general and the rooms people made, not anyone's own notes room", () => {
    const log = [
      make("jow", { op: "room.create", id: "r-notes-1", name: "", members: [{ name: "jow", pk: "pk-jow" }], self: true }),
      make("jow", { op: "room.create", id: "r-notes-2", name: "", members: [{ name: "jow", pk: "pk-jow" }], self: true }),
      make("jow", {
        op: "room.create",
        id: "r-plan",
        name: "plan",
        members: [
          { name: "jow", pk: "pk-jow" },
          { name: "win", pk: "pk-win" },
        ],
      }),
    ]
    const state = fold(log, roster, 0)
    expect([...state.rooms.values()].filter((r) => r.self).map((r) => r.id)).toEqual(["r-notes-1", "r-notes-2"])
    expect(roomsOf(state, log, "jow", {}, 0).map((r) => [r.id, r.name])).toEqual([
      ["general", "general"],
      ["r-plan", "plan"],
    ])
  })
})
