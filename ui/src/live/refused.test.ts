import { describe, expect, test } from "bun:test"
import { RelayError } from "@kiwi/core/client/relay-errors.ts"
import { Rejected } from "@kiwi/core/refusals.ts"
import { refusal } from "~/live/refused"

describe("refusal", () => {
  test("a message the client refuses to send goes back, with why", () => {
    expect(refusal(new Rejected("a message is at most 100,000 characters; this one is 120,000"))).toBe("a message is at most 100,000 characters; this one is 120,000")
  })

  test("the same refusal through the desktop bridge, as a plain error with its tag", () => {
    expect(refusal(Object.assign(new Error("an image must be png, jpg, gif or webp"), { _tag: "Rejected" }))).toBe("an image must be png, jpg, gif or webp")
  })

  test("the relay refusing what no retry fixes", () => {
    expect(refusal(new RelayError(413, "request too large", "TooLarge"))).toBe("request too large")
    expect(refusal(new RelayError(400, "bad message"))).toBe("bad message")
    expect(refusal(new RelayError(403, "this seat is read-only", "ReadOnly"))).toBe("this seat is read-only")
  })

  test("what a retry can fix keeps Retry: the network, rate limits, the relay's own trouble, a lapsed sign-in", () => {
    expect(refusal(new TypeError("Failed to fetch"))).toBeNull()
    expect(refusal(new RelayError(429, "slow down", "TooMany"))).toBeNull()
    expect(refusal(new RelayError(500, "oops"))).toBeNull()
    expect(refusal(new RelayError(401, "sign in again", "SignInRequired"))).toBeNull()
    expect(refusal("nope")).toBeNull()
  })
})
