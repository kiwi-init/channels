import { describe, expect, test } from "bun:test"

import { specOfWanted } from "~/live/open-message"

const hasSpec = (seq: number): boolean => seq === 150

describe("where a message opens when its thread has a spec (T501)", () => {
  test("the spec's own number opens the spec, also before its message is loaded", () => {
    expect(specOfWanted({ code: "kiwi", seq: 150 }, "kiwi", null, hasSpec)).toBe(150)
  })

  test("a comment on one line of the spec opens the spec", () => {
    expect(specOfWanted({ code: "kiwi", seq: 152 }, "kiwi", { inThread: 150, specLine: true }, hasSpec)).toBe(150)
  })

  test("a plain reply opens where it was said, not in the spec", () => {
    expect(specOfWanted({ code: "kiwi", seq: 151 }, "kiwi", { inThread: 150 }, hasSpec)).toBeUndefined()
  })

  test("a reply in a thread with no spec opens where it was said", () => {
    expect(specOfWanted({ code: "kiwi", seq: 141 }, "kiwi", { inThread: 140 }, hasSpec)).toBeUndefined()
  })

  test("a number wanted in another channel opens nothing here", () => {
    expect(specOfWanted({ code: "ops", seq: 150 }, "kiwi", null, hasSpec)).toBeUndefined()
  })
})
