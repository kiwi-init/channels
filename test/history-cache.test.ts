// Reload rules for the web history cache (packages/channel/src/history-plan.ts).
// A hole or a seq past the relay's head loads the usual window. A contiguous
// run fetches only what is newer than its last seq.

import { expect, test } from "bun:test";
import { planReload, wholeLog } from "@kiwi/channel/history-plan.ts";

const LIMIT = 2_000;

test("nothing cached: the usual window", () => {
  expect(planReload([], 0, LIMIT)).toEqual({ keep: [], since: 0 });
  expect(planReload([], 50, LIMIT)).toEqual({ keep: [], since: 0 });
  expect(planReload([], 5_000, LIMIT)).toEqual({ keep: [], since: 3_000 });
});

test("a contiguous run fetches only what is newer", () => {
  expect(planReload([8, 9, 10], 10, LIMIT)).toEqual({ keep: [8, 9, 10], since: 10 });
  expect(planReload([8, 9, 10], 12, LIMIT)).toEqual({ keep: [8, 9, 10], since: 10 });
});

test("a hole drops the cache", () => {
  expect(planReload([1, 2, 4], 4, LIMIT)).toEqual({ keep: [], since: 0 });
});

test("a seq past the relay head is not kept, and does not count as a hole", () => {
  expect(planReload([1, 2, 9], 2, LIMIT)).toEqual({ keep: [1, 2], since: 2 });
});

test("the whole log is only a cache that starts at the first message", () => {
  expect(wholeLog(10, LIMIT, undefined)).toBe(true);
  expect(wholeLog(10, LIMIT, 1)).toBe(true);
  expect(wholeLog(10, LIMIT, 8)).toBe(false);
  expect(wholeLog(5_000, LIMIT, 1)).toBe(false);
});

test("only the newest limit messages are kept", () => {
  const seqs = Array.from({ length: 10 }, (_, i) => i + 1);
  expect(planReload(seqs, 10, 3)).toEqual({ keep: [8, 9, 10], since: 10 });
});

test("a cache that ends before the window is dropped, so a reload never streams more than the window", () => {
  const island = Array.from({ length: 101 }, (_, i) => 100 + i); // 100..200
  expect(planReload(island, 5_000, LIMIT)).toEqual({ keep: [], since: 3_000 });
  // Ending exactly where the window starts is still outside it.
  expect(planReload([2_999, 3_000], 5_000, LIMIT)).toEqual({ keep: [], since: 3_000 });
});

test("a cache that reaches into the window keeps only the part inside it", () => {
  const seqs = Array.from({ length: 2_001 }, (_, i) => 2_500 + i); // 2500..4500
  const plan = planReload(seqs, 5_000, LIMIT);
  expect(plan.keep[0]).toBe(3_001);
  expect(plan.keep.at(-1)).toBe(4_500);
  expect(plan.since).toBe(4_500);
});
