// The relay's per-member limiter (T110): a flood of new keys drops the oldest windows, never every
// member's count. The table used to be cleared at 10k keys, which reset everyone at their limit.

import { expect, test } from "bun:test";
import { allow } from "../src/relay/room.ts";

test("a full table drops the oldest windows, not a member at their limit", () => {
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < 5_000; i++) allow(`t110-old-${i}`, 10, t0);
  for (let i = 0; i < 3; i++) expect(allow("t110-honest", 3, t0 + 1_000)).toBe(true);
  expect(allow("t110-honest", 3, t0 + 1_000)).toBe(false);
  // Enough new keys to pass 10,000: only the oldest windows go.
  for (let i = 0; i < 5_001; i++) expect(allow(`t110-flood-${i}`, 10, t0 + 2_000)).toBe(true);
  expect(allow("t110-honest", 3, t0 + 3_000)).toBe(false);
  // The oldest key's window was dropped, so it starts again.
  for (let i = 0; i < 10; i++) expect(allow("t110-old-0", 1, t0 + 3_000)).toBe(i === 0);
});

test("a window ends after a minute", () => {
  const t0 = 1_700_000_100_000;
  expect(allow("t110-minute", 1, t0)).toBe(true);
  expect(allow("t110-minute", 1, t0 + 59_000)).toBe(false);
  expect(allow("t110-minute", 1, t0 + 61_000)).toBe(true);
});
