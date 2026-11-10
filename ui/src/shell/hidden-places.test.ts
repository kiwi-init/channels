import { describe, expect, test } from "bun:test"

import { comingBack, hiddenKey } from "~/shell/hidden-places"

describe("hiding a room or a DM (T1503)", () => {
  test("rooms and DMs have separate keys, per channel", () => {
    expect(hiddenKey("a", { kind: "room", room: "ops" })).toBe("a/room:ops")
    expect(hiddenKey("a", { kind: "dm", with: "ops" })).toBe("a/dm:ops")
    expect(hiddenKey("b", { kind: "room", room: "ops" })).toBe("b/room:ops")
  })

  test("a hidden room stays hidden through new messages and comes back on a mention (T1846)", () => {
    const rows = [
      { key: "a/room:ops", mention: true },
      { key: "a/room:busy", mention: false },
      { key: "a/room:shown", mention: true },
    ]
    expect(comingBack(rows, ["a/room:ops", "a/room:busy"])).toEqual(["a/room:ops"])
  })

  test("a hidden direct conversation comes back when they write: every message there is to you", () => {
    expect(comingBack([{ key: "a/dm:maya", mention: true }], ["a/dm:maya"])).toEqual(["a/dm:maya"])
    expect(comingBack([{ key: "a/dm:maya", mention: false }], ["a/dm:maya"])).toEqual([])
  })
})
