import { expect, test } from "bun:test"

import type { ModView } from "../../../desktop/src/bridge.ts"
import { afkView, carryAfk } from "~/mods/carry-afk"

const storeOf = (prefs: unknown) => {
  const m = new Map<string, string>(prefs === undefined ? [] : [["ui.prefs", typeof prefs === "string" ? prefs : JSON.stringify(prefs)]])
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

test("a Calm wait kept in the app's prefs moves to the AFK mod's setting once, and the default 3 minutes needs nothing", () => {
  const off = storeOf({ calm: 0, enterSends: false })
  expect(carryAfk(off)).toBe("Off")
  expect(off.m.get("ui.prefs")).toBe(JSON.stringify({ enterSends: false }))
  expect(carryAfk(off)).toBeNull()
  expect(carryAfk(storeOf({ calm: 10 }))).toBe("10 min")
  expect(carryAfk(storeOf({ calm: 3 }))).toBeNull()
  expect(carryAfk(storeOf({ calm: 7 }))).toBeNull()
  expect(carryAfk(storeOf({ darkTheme: "x" }))).toBeNull()
  expect(carryAfk(storeOf(undefined))).toBeNull()
  expect(carryAfk(storeOf("{nope"))).toBeNull()
})

test("an app from before AFK still lists idle: the UI reads it as afk, asked and approved alike", () => {
  const old: ModView = { name: "calm", version: "1.0.0", source: "github.com/kiwi-init/mods/calm", needs: ["idle", "channels"], approved: ["idle", "channels"], state: "on" }
  expect(afkView(old)).toEqual({ ...old, needs: ["afk", "channels"], approved: ["afk", "channels"] })
})
