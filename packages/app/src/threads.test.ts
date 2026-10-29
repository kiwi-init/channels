import { expect, test } from "bun:test";

import { markSeenIn, roomsFrom, seenIn } from "./threads";

const stored = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, v),
  removeItem: (k: string) => void stored.delete(k),
  clear: () => stored.clear(),
  key: () => null,
  length: 0,
} as Storage;

test("the main mark the single feed left is frozen once per channel, kept apart from the marks that get pruned, and later marks don't move it (T1236)", () => {
  markSeenIn("rooms-from-a", { main: 12 });
  expect(roomsFrom("rooms-from-a")).toBe(12);
  markSeenIn("rooms-from-a", { main: 30 });
  expect(roomsFrom("rooms-from-a")).toBe(12);
  expect(stored.get("mc.rooms-from.rooms-from-a")).toBe("12");
  stored.set("mc.rooms-from.rooms-from-b", "7");
  markSeenIn("rooms-from-b", { main: 20 });
  expect(roomsFrom("rooms-from-b")).toBe(7);
  expect(roomsFrom("rooms-from-new")).toBe(0);
});

test("what's been seen where keeps the newest 500 places, dropping the ones seen longest ago", () => {
  const room = "seen-prune-room";
  markSeenIn(room, Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`task:${i + 1}`, i + 1])));
  const seen = seenIn(room);
  expect(Object.keys(seen)).toHaveLength(500);
  expect(seen["task:1"]).toBeUndefined();
  expect(seen["task:100"]).toBeUndefined();
  expect(seen["task:101"]).toBe(101);
  expect(seen["task:600"]).toBe(600);
});
