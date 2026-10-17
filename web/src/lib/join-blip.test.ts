import { describe, expect, test } from "bun:test"

import { ChannelGone, RelayError, Unreachable } from "@kiwi/core/client.ts"

import { isJoinBlip } from "./join-blip"

describe("isJoinBlip", () => {
  test("Unreachable and a 5xx or 429 are blips", () => {
    expect(isJoinBlip(new Unreachable({ cause: new Error("offline") }))).toBe(true)
    expect(isJoinBlip(new RelayError(502, "bad gateway", "Internal"))).toBe(true)
    expect(isJoinBlip(new RelayError(429, "slow down", "TooMany"))).toBe(true)
    expect(isJoinBlip(new TypeError("Failed to fetch"))).toBe(true)
  })

  test("ChannelGone and other refusals are not", () => {
    expect(isJoinBlip(new ChannelGone("closed"))).toBe(false)
    expect(isJoinBlip(new RelayError(404, "no such channel", "ChannelGone"))).toBe(false)
    expect(isJoinBlip(new RelayError(403, "not a member", "NotMember"))).toBe(false)
    expect(isJoinBlip(new Error("the relay passed on an owner signature that doesn't check out"))).toBe(false)
  })
})
