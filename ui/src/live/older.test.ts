import { describe, expect, test } from "bun:test"

import type { Room } from "@kiwi/core/state/types.ts"
import { openRooms, whereOfRoom } from "~/live/older"

const room = (id: string, over: Partial<Room> = {}): [string, Room] => [id, { id, name: id, createdBy: "jow", at: 0, ...over }]
const state = {
  rooms: new Map<string, Room>([
    room("general"),
    room("design"),
    room("r-secret", {
      members: [
        { name: "jow", pk: "pk-jow" },
        { name: "atlas", pk: "pk-atlas" },
      ],
    }),
    room("r-theirs", {
      members: [
        { name: "atlas", pk: "pk-atlas" },
        { name: "win", pk: "pk-win" },
      ],
    }),
    room("d-maya", {
      dm: true,
      members: [
        { name: "jow", pk: "pk-jow" },
        { name: "maya", pk: "pk-maya" },
      ],
    }),
  ]),
}

describe("older search reads only rooms the person can open (T977)", () => {
  test("public rooms, and private rooms and DMs they're in; never someone else's", () => {
    expect(openRooms(state, "jow").sort()).toEqual(["d-maya", "design", "general", "r-secret"])
    expect(openRooms(state, "maya").sort()).toEqual(["d-maya", "design", "general"])
    expect(openRooms({ rooms: new Map() }, "jow")).toEqual(["general"])
  })

  test("a DM reads as the other person, a room as itself", () => {
    expect(whereOfRoom(state, "jow", "d-maya")).toEqual({ kind: "dm", with: "maya" })
    expect(whereOfRoom(state, "jow", "design")).toEqual({ kind: "room", room: "design" })
    expect(whereOfRoom(state, "jow", "gone")).toEqual({ kind: "room", room: "gone" })
  })
})
