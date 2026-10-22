import { describe, expect, test } from "bun:test"

import { digitsLine } from "./link-digits"

describe("digitsLine", () => {
  test("splits six digits in two groups of three, and leaves anything else alone", () => {
    expect(digitsLine("012345")).toBe("012 345")
    expect(digitsLine("123")).toBe("123")
    expect(digitsLine("")).toBe("")
  })
})
