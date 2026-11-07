import { expect, test } from "bun:test"

import { carryCalm } from "~/mods/carry-calm"

const storeOf = (prefs: unknown) => {
  const m = new Map<string, string>(prefs === undefined ? [] : [["ui.prefs", typeof prefs === "string" ? prefs : JSON.stringify(prefs)]])
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

test("a Calm wait kept in the app's prefs moves to the Calm mod's setting once, and the default 3 minutes needs nothing", () => {
  const off = storeOf({ calm: 0, enterSends: false })
  expect(carryCalm(off)).toBe("Off")
  expect(off.m.get("ui.prefs")).toBe(JSON.stringify({ enterSends: false }))
  expect(carryCalm(off)).toBeNull()
  expect(carryCalm(storeOf({ calm: 10 }))).toBe("10 min")
  expect(carryCalm(storeOf({ calm: 3 }))).toBeNull()
  expect(carryCalm(storeOf({ calm: 7 }))).toBeNull()
  expect(carryCalm(storeOf({ darkTheme: "x" }))).toBeNull()
  expect(carryCalm(storeOf(undefined))).toBeNull()
  expect(carryCalm(storeOf("{nope"))).toBeNull()
})
