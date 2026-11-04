import { describe, expect, test } from "bun:test"
import { uiVersionOf } from "~/settings/ui-version"

describe("About names the UI that's running (T2382)", () => {
  test("a published UI shows the version it was stamped with", () => {
    expect(uiVersionOf("2026.11.7-a2f1fa7e3c")).toBe("2026.11.7-a2f1fa7e3c")
  })

  test("the UI the app ships with, or a dev build, says built in", () => {
    expect(uiVersionOf(undefined)).toBe("built in")
    expect(uiVersionOf("")).toBe("built in")
    expect(uiVersionOf(42)).toBe("built in")
  })
})
