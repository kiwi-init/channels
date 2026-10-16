import { describe, expect, test } from "bun:test"

import type { Handoff } from "@mc/protocol.ts"
import { handoffLabel, handoffLeft, handoffOpen } from "./handoff"

const link = (expiresAt: number, over: Partial<Handoff> = {}): Handoff => ({ url: "https://live.example.com/x", vendor: "cloudflare", expiresAt, ...over })

describe("handoff helpers", () => {
  test("a link is open until the moment it expires", () => {
    expect(handoffOpen(link(1_000), 999)).toBe(true)
    expect(handoffOpen(link(1_000), 1_000)).toBe(false)
  })

  test("the time left rounds up and says 1 min in the singular", () => {
    expect(handoffLeft(link(60_000), 0)).toBe("expires in 1 min")
    expect(handoffLeft(link(1), 0)).toBe("expires in 1 min")
    expect(handoffLeft(link(60_001), 0)).toBe("expires in 2 min")
    expect(handoffLeft(link(600_000), 0)).toBe("expires in 10 min")
  })

  test("the vendor label always shows where the link goes", () => {
    expect(handoffLabel(link(1))).toBe("cloudflare (live.example.com)")
    expect(handoffLabel(link(1, { vendor: "live.example.com" }))).toBe("live.example.com")
  })
})
