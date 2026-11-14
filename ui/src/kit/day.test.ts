import { describe, expect, test } from "bun:test"

import { t } from "~/i18n/i18n"
import { day } from "~/kit/time"

type Label = "today" | "yesterday" | "date"

const ZONES = ["America/New_York", "Europe/Berlin", "Australia/Sydney", "UTC", "Asia/Kolkata"] as const

const REPORTED: readonly (readonly [string, number, number])[] = [
  ["America/New_York", 1741494600000, 1741579200000],
  ["America/New_York", 1741492800000, 1741579200001],
  ["America/New_York", 1741494600000, 1741582800000],
  ["America/New_York", 1741496340000, 1741582800000],
  ["America/New_York", 1741496399999, 1741586400000],
  ["America/New_York", 1762056000000, 1762146000000],
  ["America/New_York", 1762056000000, 1762146000001],
  ["America/New_York", 1762056000000, 1762149600000],
  ["America/New_York", 1772942400000, 1773030600000],
  ["America/New_York", 1772942400000, 1773032400000],
  ["America/New_York", 1772944200000, 1773032400000],
  ["America/New_York", 1772945999999, 1773032400000],
  ["America/New_York", 1772945940000, 1773036000000],
  ["America/New_York", 1772945999999, 1773036000000],
  ["Australia/Sydney", 1743858000000, 1743948000000],
  ["Australia/Sydney", 1743858000000, 1743948060000],
  ["Australia/Sydney", 1759582800000, 1759669200000],
  ["Australia/Sydney", 1759586399999, 1759669200000],
  ["Australia/Sydney", 1759582800000, 1759669260000],
  ["Australia/Sydney", 1759582800000, 1759671000000],
  ["Australia/Sydney", 1759582800000, 1759672800000],
  ["Australia/Sydney", 1759586399999, 1759672800000],
  ["Australia/Sydney", 1759582800000, 1759676400000],
  ["Australia/Sydney", 1759586340000, 1759676400000],
  ["Australia/Sydney", 1775307600000, 1775397660000],
  ["Australia/Sydney", 1775307600000, 1775480400000],
  ["Australia/Sydney", 1791032400000, 1791118800000],
  ["Australia/Sydney", 1791034200000, 1791118800000],
  ["Australia/Sydney", 1791032400000, 1791118800001],
  ["Australia/Sydney", 1791032400000, 1791122400000],
  ["Australia/Sydney", 1791034200000, 1791122400000],
  ["Australia/Sydney", 1791035940000, 1791122400000],
  ["Australia/Sydney", 1791035940000, 1791126000000],
  ["Australia/Sydney", 1791035999999, 1791126000000],
  ["Australia/Sydney", 1791032400000, 1791201600000],
  ["Europe/Berlin", 1743285600000, 1743372000000],
  ["Europe/Berlin", 1743285600000, 1743372000001],
  ["Europe/Berlin", 1743289140000, 1743375600000],
  ["Europe/Berlin", 1743285600000, 1743379200000],
  ["Europe/Berlin", 1743287400000, 1743379200000],
  ["Europe/Berlin", 1761429600000, 1761519600000],
  ["Europe/Berlin", 1761429600000, 1761519660000],
  ["Europe/Berlin", 1774737000000, 1774821600000],
  ["Europe/Berlin", 1774735200000, 1774821600001],
  ["Europe/Berlin", 1774735200000, 1774823400000],
  ["Europe/Berlin", 1774735200000, 1774825200000],
  ["Europe/Berlin", 1774738740000, 1774828800000],
  ["Europe/Berlin", 1792879200000, 1792969200000],
  ["Europe/Berlin", 1792879200000, 1793048400000],
]

const DAYS = ["2025-03-10", "2025-03-11", "2025-11-03", "2025-10-06", "2026-03-09", "2026-03-30", "2026-04-06", "2026-10-26", "2026-01-01", "2026-03-01", "2026-06-15", "2026-12-31"]

const HOUR = 3_600_000

const dateIn = (ms: number, zone: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms)

const dayNumber = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number)
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000
}

const shifted = (date: string, by: number): string => new Date((dayNumber(date) + by) * 86_400_000).toISOString().slice(0, 10)

function midnightOf(date: string, zone: string): number {
  let lo = dayNumber(date) * 86_400_000 - 15 * HOUR
  let hi = lo + 30 * HOUR
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (dateIn(mid, zone) >= date) hi = mid
    else lo = mid
  }
  return hi
}

function expected(at: number, now: number, zone: string): Label {
  const a = dayNumber(dateIn(at, zone))
  const n = dayNumber(dateIn(now, zone))
  return a >= n ? "today" : a === n - 1 ? "yesterday" : "date"
}

function labelOf(text: string): Label {
  if (text === t("kit.time.today")) return "today"
  if (text === t("kit.time.yesterday")) return "yesterday"
  return "date"
}

function cases(zone: string): { at: number; now: number }[] {
  const out = REPORTED.filter(([z]) => z === zone).map(([, at, now]) => ({ at, now }))
  for (const d of DAYS) {
    const today = midnightOf(d, zone)
    const yesterday = midnightOf(shifted(d, -1), zone)
    const before = midnightOf(shifted(d, -2), zone)
    const tomorrow = midnightOf(shifted(d, 1), zone)
    for (const now of [today, today + 1, today + 12 * HOUR, tomorrow - 1])
      for (const at of [today, today - 1, yesterday, yesterday - 1, yesterday + 1, before, before - 1, now, now + 3 * HOUR]) out.push({ at, now })
  }
  return out
}

const zone = process.env.KIWI_DAY_ZONE

if (zone) {
  describe(`day() with the process in ${zone}`, () => {
    test("the process really runs in that zone", () => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone)
    })

    test("each message is Today, Yesterday or a date by its local calendar day, across clock changes and at midnight to the millisecond", () => {
      const wrong = cases(zone)
        .map(({ at, now }) => ({ at, now, got: labelOf(day(at, now)), want: expected(at, now, zone) }))
        .filter((c) => c.got !== c.want)
        .map((c) => `${new Date(c.at).toISOString()} seen at ${new Date(c.now).toISOString()}: ${c.got}, not ${c.want}`)
      expect(wrong).toEqual([])
    })
  })
} else {
  test("the report's 49 clock-change inputs are all here", () => {
    expect(new Set(REPORTED.map(([z, at, now]) => `${z}|${at}|${now}`)).size).toBe(49)
  })

  for (const each of ZONES)
    test(`day() labels by local calendar day in ${each}, run in its own process`, () => {
      const run = Bun.spawnSync([process.execPath, "test", import.meta.path], { env: { ...process.env, TZ: each, KIWI_DAY_ZONE: each }, stdout: "pipe", stderr: "pipe" })
      const said = `${run.stdout.toString()}${run.stderr.toString()}`
      expect({ code: run.exitCode, ran: /\b2 pass\b/.test(said), said: run.exitCode === 0 ? "" : said.slice(-3000) }).toEqual({ code: 0, ran: true, said: "" })
    })
}
