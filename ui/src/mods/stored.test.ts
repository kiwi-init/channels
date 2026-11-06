import { expect, test } from "bun:test"

import { STORAGE } from "~/mods/protocol"
import { keep, type Store } from "~/mods/stored"

function memory(): Store & { all: Map<string, string> } {
  const all = new Map<string, string>()
  return { all, getItem: (k) => all.get(k) ?? null, setItem: (k, v) => void all.set(k, v) }
}

test("each mod keeps its own values, by key", () => {
  const s = memory()
  expect(keep(s, "linear", "set", "token", '"a"')).toBeNull()
  expect(keep(s, "linear", "get", "token", null)).toBe('"a"')
  expect(keep(s, "github", "get", "token", null)).toBeNull()
  expect(keep(s, "github", "keys", null, null)).toEqual([])
  keep(s, "linear", "set", "seen", "3")
  expect(keep(s, "linear", "keys", null, null)).toEqual(["token", "seen"])
  keep(s, "linear", "remove", "token", null)
  expect(keep(s, "linear", "keys", null, null)).toEqual(["seen"])
  expect([...s.all.keys()]).toEqual(["kiwi-mod-data:linear"])
})

test("a mod that would pass its total gets an error and keeps what it had", () => {
  const s = memory()
  keep(s, "big", "set", "a", "x".repeat(STORAGE.value))
  for (let i = 0; i < 2; i++) keep(s, "big", "set", `b${i}`, "x".repeat(STORAGE.value))
  expect(() => keep(s, "big", "set", "c", "x".repeat(STORAGE.value))).toThrow("big keeps at most 1,000,000 characters")
  expect(keep(s, "big", "keys", null, null)).toEqual(["a", "b0", "b1"])
})

test("storage the page can't read starts empty, and a key named like an object's own still works", () => {
  const s = memory()
  s.setItem("kiwi-mod-data:odd", "not json")
  expect(keep(s, "odd", "keys", null, null)).toEqual([])
  s.setItem("kiwi-mod-data:odd", JSON.stringify({ n: 1, ok: "y" }))
  expect(keep(s, "odd", "keys", null, null)).toEqual(["ok"])
  expect(keep(s, "odd", "get", "constructor", null)).toBeNull()
  expect(keep(s, "odd", "get", "__proto__", null)).toBeNull()
  keep(s, "odd", "set", "__proto__", '"kept"')
  expect(keep(s, "odd", "get", "__proto__", null)).toBe('"kept"')
  expect(keep(s, "odd", "keys", null, null)).toEqual(["ok", "__proto__"])
})
