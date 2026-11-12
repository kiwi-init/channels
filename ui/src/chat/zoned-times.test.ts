import { describe, expect, test } from "bun:test"

import { localOf, segments, tooltipOf } from "~/chat/zoned-times"

const SENT = Date.UTC(2030, 0, 16, 22, 0, 0)
const plain = (text: string, at: number | undefined = SENT): string => {
  const found = segments(text, at)
  return found === null ? text : found.map((s) => (typeof s === "string" ? s : `[${s.token}](kiwi-utc:${s.iso})`)).join("")
}

describe("zoned times are recognized in prose (#2367)", () => {
  test("a full UTC timestamp carries its own instant", () => {
    expect(plain("meet at 2030-01-16T01:15:00Z sharp")).toBe("meet at [2030-01-16T01:15:00Z](kiwi-utc:2030-01-16T01:15:00Z) sharp")
    expect(plain("meet at 2030-01-16T01:15Z sharp")).toBe("meet at [2030-01-16T01:15Z](kiwi-utc:2030-01-16T01:15:00Z) sharp")
  })

  test("a time-only token takes the message's UTC date", () => {
    expect(plain("standup 06:30Z ok?")).toBe("standup [06:30Z](kiwi-utc:2030-01-16T06:30:00Z) ok?")
    expect(plain("standup 06:30 UTC ok?")).toBe("standup [06:30 UTC](kiwi-utc:2030-01-16T06:30:00Z) ok?")
  })

  test("several times in one text convert, and URLs around them stay whole", () => {
    expect(plain("a 06:30Z and 23:45Z pair")).toBe("a [06:30Z](kiwi-utc:2030-01-16T06:30:00Z) and [23:45Z](kiwi-utc:2030-01-16T23:45:00Z) pair")
    expect(plain("see https://x.test/06:30Z now")).toBe("see https://x.test/06:30Z now")
    expect(plain("see https://x.test/06:30Z then 07:00Z after")).toBe("see https://x.test/06:30Z then [07:00Z](kiwi-utc:2030-01-16T07:00:00Z) after")
  })

  test("invalid values stay as written", () => {
    for (const text of ["25:00Z is wrong", "12:60Z too", "2030-02-30T01:15Z no such day", "23:59:60Z never", "06:30 Z spaced", "06:30 plain"]) expect(plain(text)).toBe(text)
  })

  test("a time-only token without a message date stays unconverted; a full timestamp still converts", () => {
    expect(segments("standup 06:30Z ok?", undefined)).toBe(null)
    expect(plain("meet 2030-01-16T01:15Z", undefined)).toBe("meet [2030-01-16T01:15Z](kiwi-utc:2030-01-16T01:15:00Z)")
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
