import { describe, expect, test } from "bun:test"
import { isMuted, muteKey } from "~/live/mute"
import { readPrefs } from "~/live/prefs"

describe("muting a channel or a room (T972)", () => {
  test("a muted channel, or one room of it, is muted; the channel's other rooms aren't", () => {
    const muted = [muteKey("c1"), muteKey("c2", "r-ops")]
    expect(isMuted(muted, "c1")).toBe(true)
    expect(isMuted(muted, "c2", "r-ops")).toBe(true)
    expect(isMuted(muted, "c2", "general")).toBe(false)
  })

  test("saved mutes read back, and anything malformed is dropped", () => {
    const store = (raw: unknown) => ({ getItem: (k: string) => (k === "ui.prefs" ? JSON.stringify(raw) : "1"), setItem: () => {} })
    expect(readPrefs(store({ muted: ["c1", "c2/r"] })).muted).toEqual(["c1", "c2/r"])
    expect(readPrefs(store({ muted: [1, "", "c1", "c1"] })).muted).toEqual(["c1"])
  })
})
