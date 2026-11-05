import { describe, expect, test } from "bun:test"

import { PLEDGE, pledged } from "~/start/onboarded"

describe("the onboarding's pledge", () => {
  test("typing the sentence ends it, in any case", () => {
    expect(pledged(PLEDGE)).toBe(true)
    expect(pledged("channels is not a harness")).toBe(true)
    expect(pledged("CHANNELS IS NOT A HARNESS")).toBe(true)
  })

  test("anything else keeps it open", () => {
    expect(pledged("")).toBe(false)
    expect(pledged("Channels is not a harnes")).toBe(false)
    expect(pledged("Channels is not a harness.")).toBe(false)
    expect(pledged("Channels is a harness")).toBe(false)
    expect(pledged(" Channels is not a harness")).toBe(false)
  })
})
