import { describe, expect, test } from "bun:test"

import { MAX_ROOM_NAME, MAX_ROOMS } from "@kiwi/core/protocol.ts"
import { cleanRoomName, roomProblem, roomsAfter } from "./rooms"

const general = { id: "general", name: "general" }
const desktop = { id: "k3x9a1b2", name: "desktop" }

describe("a room the owner makes or renames from channel settings (T987)", () => {
  test("its name is what the fold keeps: no leading #, spaces folded, at most 40 characters", () => {
    expect(cleanRoomName("#mobile")).toBe("mobile")
    expect(cleanRoomName("  ##iOS   builders ")).toBe("iOS builders")
    expect(cleanRoomName("x".repeat(60)).length).toBe(MAX_ROOM_NAME)
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
    expect(roomsAfter([general, desktop], { id: "m0b1le00", name: "#mobile" })).toEqual([desktop, { id: "m0b1le00", name: "mobile" }])
    expect(roomsAfter([general, desktop], { id: desktop.id, name: "electrobun" })).toEqual([{ id: desktop.id, name: "electrobun" }])
    expect(roomsAfter([general, desktop], { id: "general", name: "lobby" })).toEqual([{ id: "general", name: "lobby" }, desktop])
  })
})
