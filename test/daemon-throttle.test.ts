import { expect, test } from "bun:test";
import { throttled } from "../src/daemon/throttle.ts";

test("a burst of requests runs one seat sync, never two at once, and the next only after the gap", async () => {
  let at = 0;
  let runs = 0;
  let release: (() => void) | null = null;
  const sync = throttled(
    () =>
      new Promise<void>((resolve) => {
        runs++;
        release = resolve;
      }),
    2_000,
    () => at,
  );
  for (let i = 0; i < 100; i++) sync.soon();
  expect(runs).toBe(1);
  const tick = sync.now();
  expect(runs).toBe(1);
  release!();
  await tick;
  at = 1_000;
  sync.soon();
  expect(runs).toBe(1);
  at = 2_000;
  sync.soon();
  expect(runs).toBe(2);
  release!();
  await sync.now();
  const failing = throttled(
    () => Promise.reject(new Error("config unreadable")),
    0,
    () => at,
  );
  await failing.now();
  failing.soon();
});
