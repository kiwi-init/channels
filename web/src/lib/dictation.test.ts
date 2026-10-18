import { describe, expect, test } from "bun:test"

import { appendDictation, dictationProblem, UNAVAILABLE_MESSAGE } from "./dictation"

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

describe("dictationProblem", () => {
  test("a browser with no speech service says so and marks dictation unavailable", () => {
    for (const error of ["network", "service-not-allowed", "language-not-supported"]) expect(dictationProblem(error)).toEqual({ unavailable: true, message: UNAVAILABLE_MESSAGE })
  })

  test("a blocked microphone asks for permission and leaves dictation available", () => {
    for (const error of ["not-allowed", "audio-capture"]) expect(dictationProblem(error)).toMatchObject({ unavailable: false, message: expect.stringContaining("Microphone blocked") })
  })

  test("a pause, an abort or no speech is not a problem", () => {
    for (const error of ["no-speech", "aborted"]) expect(dictationProblem(error)).toBeNull()
  })
})
