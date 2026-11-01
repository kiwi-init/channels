import { describe, expect, test } from "bun:test"

import { comingBack, hiddenKey } from "~/shell/hidden-places"

describe("hiding a room or a DM (T1503)", () => {
  test("rooms and DMs have separate keys, per channel", () => {
    expect(hiddenKey("a", { kind: "room", room: "ops" })).toBe("a/room:ops")
    expect(hiddenKey("a", { kind: "dm", with: "ops" })).toBe("a/dm:ops")
    expect(hiddenKey("b", { kind: "room", room: "ops" })).toBe("b/room:ops")
  })

  test("a hidden place with news comes back, and nothing else does", () => {
    const rows = [
      { key: "a/room:ops", news: true },
      { key: "a/room:quiet", news: false },
      { key: "a/room:shown", news: true },
    ]
    expect(comingBack(rows, ["a/room:ops", "a/room:quiet"])).toEqual(["a/room:ops"])
  })
})
