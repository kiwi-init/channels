import { describe, expect, test } from "bun:test"
import { updateFound } from "~/settings/update-check"

describe("Check for updates says what it found (T380)", () => {
  test("each result reads as a sentence about this app", () => {
    expect(updateFound(null)).toBe("Channels looks for a newer release every few hours.")
    expect(updateFound({ state: "current", version: "2026.10.8" })).toBe("Channels 2026.10.8 is the latest.")
    expect(updateFound({ state: "failed" })).toBe("Couldn't reach GitHub. Try again in a moment.")
    expect(updateFound({ state: "downloading", version: "2026.10.9" })).toBe("Downloading Channels 2026.10.9…")
    expect(updateFound({ state: "ready", version: "2026.10.9" })).toBe("Channels 2026.10.9 is ready. It goes in when you restart.")
    expect(updateFound({ state: "available", version: "2026.10.9" })).toBe("Channels 2026.10.9 is out.")
  })

  test("an install that can't replace itself says where to get the update", () => {
    expect(updateFound({ state: "available", version: "2026.10.9", blocked: true })).toBe("Channels can't update itself here. Get it from the release.")
  })
})
