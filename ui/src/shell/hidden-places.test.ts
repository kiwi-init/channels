import { describe, expect, test } from "bun:test"

import { comingBack, hiddenKey } from "~/shell/hidden-places"

describe("hiding a room (T1503)", () => {
  test("a room's key is per channel", () => {
    expect(hiddenKey("a", "ops")).toBe("a/room:ops")
    expect(hiddenKey("b", "ops")).toBe("b/room:ops")
  })

  test("a hidden room stays hidden through new messages and comes back on a mention (T1846)", () => {
    const rows = [
      { key: "a/room:ops", mention: true },
      { key: "a/room:busy", mention: false },
      { key: "a/room:shown", mention: true },
    ]
    expect(comingBack(rows, ["a/room:ops", "a/room:busy"])).toEqual(["a/room:ops"])
  })
})
