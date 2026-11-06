import { describe, expect, test } from "bun:test"

import { wordsPlain, wordsRaw, wrote } from "~/words"

describe("Words", () => {
  test("can't be shown raw by a template, a + or String(), so a missed site fails loudly (#1763)", () => {
    const words = wrote("ask @gentle-otter")
    expect(() => `${words}`).toThrow(TypeError)
    expect(() => "said: " + words).toThrow(TypeError)
    expect(() => String(words)).toThrow(TypeError)
  })

  test("reads through wordsRaw and wordsPlain", () => {
    const words = wrote("ask @gentle-otter")
    expect(wordsRaw(words)).toBe("ask @gentle-otter")
    expect(wordsPlain(words, new Map([["gentle-otter", "opus-coder"]]))).toBe("ask @opus-coder")
  })
})
