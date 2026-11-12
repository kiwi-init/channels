import { describe, expect, test } from "bun:test"

import { localOf, tooltipOf, zonedTimes } from "~/chat/zoned-times"

const SENT = Date.UTC(2030, 0, 16, 22, 0, 0)

describe("zoned times are recognized in prose (#2367)", () => {
  test("a full UTC timestamp becomes a kiwi link carrying its own instant", () => {
    expect(zonedTimes("meet at 2030-01-16T01:15:00Z sharp", SENT)).toBe("meet at [2030-01-16T01:15:00Z](kiwi-utc:2030-01-16T01:15:00Z) sharp")
    expect(zonedTimes("meet at 2030-01-16T01:15Z sharp", SENT)).toBe("meet at [2030-01-16T01:15Z](kiwi-utc:2030-01-16T01:15:00Z) sharp")
  })

  test("a time-only token takes the message's UTC date", () => {
    expect(zonedTimes("standup 06:30Z ok?", SENT)).toBe("standup [06:30Z](kiwi-utc:2030-01-16T06:30:00Z) ok?")
    expect(zonedTimes("standup 06:30 UTC ok?", SENT)).toBe("standup [06:30 UTC](kiwi-utc:2030-01-16T06:30:00Z) ok?")
  })

  test("several times, bold text, list items and table cells all convert", () => {
    expect(zonedTimes("a 06:30Z and 23:45Z pair", SENT)).toBe("a [06:30Z](kiwi-utc:2030-01-16T06:30:00Z) and [23:45Z](kiwi-utc:2030-01-16T23:45:00Z) pair")
    expect(zonedTimes("**deal at 06:30Z**", SENT)).toBe("**deal at [06:30Z](kiwi-utc:2030-01-16T06:30:00Z)**")
    expect(zonedTimes("- first 06:30Z\n- second 23:45Z", SENT)).toBe("- first [06:30Z](kiwi-utc:2030-01-16T06:30:00Z)\n- second [23:45Z](kiwi-utc:2030-01-16T23:45:00Z)")
    expect(zonedTimes("| when |\n| --- |\n| 06:30Z |", SENT)).toBe("| when |\n| --- |\n| [06:30Z](kiwi-utc:2030-01-16T06:30:00Z) |")
  })

  test("invalid values and impossible dates stay as written", () => {
    const keep = ["25:00Z is wrong", "12:60Z too", "2030-02-30T01:15Z no such day", "23:59:60Z never", "06:30 Z spaced"]
    for (const text of keep) expect(zonedTimes(text, SENT)).toBe(text)
  })

  test("unzoned numbers, URLs, inline code and fenced code stay as written", () => {
    expect(zonedTimes("06:30 plain", SENT)).toBe("06:30 plain")
    expect(zonedTimes("see https://x.test/06:30Z now", SENT)).toBe("see https://x.test/06:30Z now")
    expect(zonedTimes("run `06:30Z` locally", SENT)).toBe("run `06:30Z` locally")
    expect(zonedTimes("```\n06:30Z\n```", SENT)).toBe("```\n06:30Z\n```")
    expect(zonedTimes("text [link](http://x.test/06:30Z) here", SENT)).toBe("text [link](http://x.test/06:30Z) here")
  })

  test("markdown structure holds: code in a blockquote, code spans with inner backticks, and link labels stay as written", () => {
    expect(zonedTimes("> ~~~\n> 06:30Z\n> ~~~", SENT)).toBe("> ~~~\n> 06:30Z\n> ~~~")
    expect(zonedTimes("``a ` 06:30Z`` stays code", SENT)).toBe("``a ` 06:30Z`` stays code")
    expect(zonedTimes("[06:30Z](https://example.com) stays one link", SENT)).toBe("[06:30Z](https://example.com) stays one link")
    expect(zonedTimes("[see 06:30Z here](https://example.com)", SENT)).toBe("[see 06:30Z here](https://example.com)")
  })

  test("a time-only token without a message date stays unconverted; a full timestamp still converts", () => {
    expect(zonedTimes("standup 06:30Z ok?", undefined)).toBe("standup 06:30Z ok?")
    expect(zonedTimes("meet 2030-01-16T01:15Z", undefined)).toBe("meet [2030-01-16T01:15Z](kiwi-utc:2030-01-16T01:15:00Z)")
  })
})

describe("zoned times convert with fixed timezones (#2367)", () => {
  test("a plain offset zone: GMT-3", () => {
    expect(localOf("2030-01-16T06:30:00Z", "America/Sao_Paulo", "en")).toEqual({ time: "03:30", zone: "GMT-3", date: null })
  })

  test("fractional offsets: +05:30 and +05:45", () => {
    expect(localOf("2030-01-16T06:30:00Z", "Asia/Kolkata", "en")).toEqual({ time: "12:00", zone: "GMT+5:30", date: null })
    expect(localOf("2030-01-16T06:30:00Z", "Asia/Kathmandu", "en")).toEqual({ time: "12:15", zone: "GMT+5:45", date: null })
  })

  test("daylight saving follows the date, not a fixed offset", () => {
    expect(localOf("2026-03-08T06:30:00Z", "America/New_York", "en")).toEqual({ time: "01:30", zone: "EST", date: null })
    expect(localOf("2026-06-08T06:30:00Z", "America/New_York", "en")).toEqual({ time: "02:30", zone: "EDT", date: null })
  })

  test("midnight rolls the local date in both directions", () => {
    expect(localOf("2030-01-16T00:30:00Z", "Asia/Kathmandu", "en").date).toBe(null)
    expect(localOf("2030-01-16T00:30:00Z", "America/Sao_Paulo", "en")).toEqual({ time: "21:30", zone: "GMT-3", date: "Jan 15" })
    expect(localOf("2030-01-16T23:30:00Z", "Asia/Kathmandu", "en")).toEqual({ time: "05:15", zone: "GMT+5:45", date: "Jan 17" })
  })

  test("the tooltip says the assumed date for a time-only token, with and without a rollover", () => {
    const assuming = (date: string): string => `assuming ${date} UTC, the message date`
    expect(tooltipOf("2030-01-16T06:30:00Z", true, assuming, "America/Sao_Paulo", "en")).toBe("03:30 GMT-3 · assuming 2030-01-16 UTC, the message date")
    expect(tooltipOf("2030-01-16T23:30:00Z", true, assuming, "Asia/Kathmandu", "en")).toBe("05:15 GMT+5:45 · Jan 17 · assuming 2030-01-16 UTC, the message date")
    expect(tooltipOf("2030-01-16T23:30:00Z", false, assuming, "Asia/Kathmandu", "en")).toBe("05:15 GMT+5:45 · Jan 17")
  })

  test("a malformed instant converts to nothing instead of throwing", () => {
    const assuming = (date: string): string => `assuming ${date} UTC, the message date`
    expect(localOf("garbage", "America/Sao_Paulo", "en")).toBe(null)
    expect(tooltipOf("garbage", false, assuming, "America/Sao_Paulo", "en")).toBe(null)
    expect(tooltipOf("", true, assuming, "UTC", "en")).toBe(null)
  })
})
