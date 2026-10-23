import { describe, expect, test } from "bun:test"

import { MAX_ROOM_NAME, MAX_ROOMS } from "@kiwi/core/protocol.ts"
import { cleanRoomName, roomOfMessage, roomProblem, roomsAfter } from "./rooms"

const general = { id: "general", name: "general" }
const desktop = { id: "k3x9a1b2", name: "desktop" }

describe("a room the owner makes or renames from channel settings (T987)", () => {
  test("its name is what the fold keeps: no leading #, spaces folded, at most 40 characters", () => {
    expect(cleanRoomName("#mobile")).toBe("mobile")
    expect(cleanRoomName("  ##iOS   builders ")).toBe("iOS builders")
    expect(cleanRoomName("x".repeat(60)).length).toBe(MAX_ROOM_NAME)
    expect(cleanRoomName("# #mobile")).toBe("mobile")
    for (const typed of ["# #mobile", " ## iOS  builders", "x".repeat(60), "#a #b"]) expect(cleanRoomName(cleanRoomName(typed))).toBe(cleanRoomName(typed))
  })

  test("a name typed with more #s and spaces is the same name: refused when taken, and signed exactly as the event sends it", () => {
    const mobile = { id: "m0b1le00", name: "mobile" }
    expect(roomProblem([general, mobile], "# #mobile")).toBe("A room is already called #mobile")
    const sent = { id: "n3w00000", name: cleanRoomName("#a #b") }
    expect(roomsAfter([general], sent)).toEqual([sent])
  })

  test("is refused before it's sent for what the fold would refuse: no name, a name taken in any case, too many rooms", () => {
    expect(roomProblem([general, desktop], "  # ")).toBe("A room needs a name")
    expect(roomProblem([general, desktop], "Desktop")).toBe("A room is already called #Desktop")
    expect(roomProblem([general, desktop], "mobile")).toBeNull()
    expect(roomProblem([general, desktop], "DESKTOP", desktop.id)).toBeNull()
    expect(roomProblem([general, desktop], "general", desktop.id)).toBe("A room is already called #general")
    const full = Array.from({ length: MAX_ROOMS }, (_, i) => ({ id: `r${i}`, name: `room-${i}` }))
    expect(roomProblem(full, "one more")).toBe(`A channel holds at most ${MAX_ROOMS} rooms`)
    expect(roomProblem(full, "renamed", "r3")).toBeNull()
  })

  test("signs the room list as it is after the change, leaving #general out unless it was renamed", () => {
    expect(roomsAfter([general, desktop], { id: "m0b1le00", name: cleanRoomName("#mobile") })).toEqual([desktop, { id: "m0b1le00", name: "mobile" }])
    expect(roomsAfter([general, desktop], { id: desktop.id, name: "electrobun" })).toEqual([{ id: desktop.id, name: "electrobun" }])
    expect(roomsAfter([general, desktop], { id: "general", name: "lobby" })).toEqual([{ id: "general", name: "lobby" }, desktop])
  })
})

describe("a room is its own conversation (T1030)", () => {
  test("a message is in the room the fold put it in, one still sending in the room it was sent to, and anything else in #general", () => {
    const state = { roomOf: new Map([[7, "k3x9a1b2"]]) }
    expect(roomOfMessage(state, { seq: 7 })).toBe("k3x9a1b2")
    expect(roomOfMessage(state, { seq: 7, room: "other" })).toBe("k3x9a1b2")
    expect(roomOfMessage(state, { seq: -3, room: "k3x9a1b2" })).toBe("k3x9a1b2")
    expect(roomOfMessage(state, { seq: 8 })).toBe("general")
  })
})
