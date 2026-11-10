import { expect, test } from "bun:test"

import { joinName, nameProblemOf } from "~/start/join-name"

test("an account name that is a handle is used as it is, and nothing is asked", () => {
  expect(joinName("jow")).toEqual({ name: "jow", asks: false })
})

test("spaces, emoji and length are made into a handle, and nothing is asked", () => {
  expect(joinName("Jonatas Walker")).toEqual({ name: "jonatas-walker", asks: false })
  expect(joinName("🙂 Jow 🙂")).toEqual({ name: "jow", asks: false })
  const long = joinName("a".repeat(60))
  expect(long.name).toHaveLength(32)
  expect(long.asks).toBe(false)
})

test("a name nobody may join under lands on the field, with the reason", () => {
  for (const taken of ["Admin", "kiwi", "You", "everyone"]) {
    const got = joinName(taken)
    expect(got.asks).toBe(true)
    expect(nameProblemOf(got.name)).toBe("reserved")
  }
})

test("no account yet lands on the field", () => {
  expect(joinName(undefined)).toEqual({ name: "", asks: true })
  expect(nameProblemOf("")).toBe("allowed")
})

test("what the person types is judged the same way", () => {
  expect(nameProblemOf("has space")).toBe("allowed")
  expect(nameProblemOf("a".repeat(33))).toBe("allowed")
  expect(nameProblemOf("🙂")).toBe("allowed")
  expect(nameProblemOf("maya")).toBe(null)
})
