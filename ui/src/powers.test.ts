import { describe, expect, test } from "bun:test"
import { ALL_POWERS, NO_POWERS, trusted } from "~/model"

describe("full trust is every power at once (T471)", () => {
  test("on only when all three powers are on, and off when any one is", () => {
    expect(trusted(ALL_POWERS)).toBe(true)
    expect(trusted(NO_POWERS)).toBe(false)
    for (const power of ["addsAgents", "answersDecisions", "managesAgents"] as const) expect(trusted({ ...ALL_POWERS, [power]: false })).toBe(false)
  })
})
