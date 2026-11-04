import { describe, expect, test } from "bun:test"
import { QUOTES, quoteOf } from "~/start/quotes"

describe("the quote on Home", () => {
  test("stays the same all day and changes the next", () => {
    const morning = new Date(2026, 10, 3, 7, 0).getTime()
    const night = new Date(2026, 10, 3, 23, 30).getTime()
    const tomorrow = new Date(2026, 10, 4, 7, 0).getTime()
    expect(quoteOf(night)).toBe(quoteOf(morning))
    expect(quoteOf(tomorrow)).not.toBe(quoteOf(morning))
  })

  test("every quote names who wrote it and where", () => {
    for (const q of QUOTES) expect([q.text.length > 0, q.by.length > 0, q.in.length > 0]).toEqual([true, true, true])
    expect(new Set(QUOTES.map((q) => q.text)).size).toBe(QUOTES.length)
  })
})
