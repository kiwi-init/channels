import { afterEach, expect, test } from "bun:test"
import { lastChannel, rememberChannel, reopenable } from "./last-channel"

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage

afterEach(() => store.clear())

test("the channel that was open is the one a launch reopens, while it's still a channel you're in", () => {
  rememberChannel("mc2-a")
  expect(lastChannel()).toBe("mc2-a")
  expect(reopenable(lastChannel(), [{ code: "mc2-a", state: "member" }])).toBe("mc2-a")
  expect(reopenable(lastChannel(), [{ code: "mc2-a", state: "elsewhere" }])).toBeNull()
  expect(reopenable(lastChannel(), [{ code: "mc2-b", state: "member" }])).toBeNull()
})

test("closing the channel forgets it, so the next launch opens nothing", () => {
  rememberChannel("mc2-a")
  rememberChannel(null)
  expect(lastChannel()).toBeNull()
  expect(reopenable(lastChannel(), [{ code: "mc2-a", state: "member" }])).toBeNull()
})
