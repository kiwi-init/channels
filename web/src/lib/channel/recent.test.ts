import { afterEach, expect, test } from "bun:test"

const disk = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => disk.get(k) ?? null,
    setItem: (k: string, v: string) => void disk.set(k, v),
    removeItem: (k: string) => void disk.delete(k),
  },
})
const { loadRecent } = await import("./recent")

afterEach(() => disk.clear())

test("a saved preview whose time no date can hold is dropped, so the channel list still renders (T136)", () => {
  disk.set("mc.recent.bad", JSON.stringify({ from: "mallory", text: "hi", ts: 1e16, people: [] }))
  expect(loadRecent("bad")).toBeNull()
  const good = { from: "ana", text: "hi", ts: Date.UTC(2026, 9, 20), people: ["ana"] }
  disk.set("mc.recent.good", JSON.stringify(good))
  expect(loadRecent("good")).toEqual(good)
})
