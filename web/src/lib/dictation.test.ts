import { describe, expect, test } from "bun:test"

import { appendDictation } from "./dictation"

describe("appendDictation", () => {
  test("starts an empty message with the transcript", () => {
    expect(appendDictation("", "  hello there ")).toBe("hello there")
  })

  test("joins with one space after text", () => {
    expect(appendDictation("ship it", "today")).toBe("ship it today")
  })

  test("does not double a space or newline already there", () => {
    expect(appendDictation("ship it ", "today")).toBe("ship it today")
    expect(appendDictation("ship it\n", "today")).toBe("ship it\ntoday")
  })

  test("ignores an empty transcript", () => {
    expect(appendDictation("ship it", "   ")).toBe("ship it")
  })
})
