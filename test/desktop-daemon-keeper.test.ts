import { expect, test } from "bun:test";

import { CHECK_EVERY_MS, keepAlive, retryAfter } from "../desktop/src/daemon-keeper.ts";

function harness(answers: boolean[], starts: boolean[], rounds: number) {
  const waits: number[] = [];
  const log: string[] = [];
  let started = 0;
  const d = {
    hello: async () => answers.shift() ?? true,
    start: async () => {
      started++;
      return starts.shift() ?? true;
    },
    log: (l: string) => void log.push(l),
    stopped: () => waits.length > rounds,
    wait: async (ms: number) => void waits.push(ms),
  };
  return { d, waits, log, started: () => started };
}

test("a daemon that answers is left alone, checked every 30s", async () => {
  const h = harness([true, true, true], [], 3);
  await keepAlive(h.d);
  expect(h.started()).toBe(0);
  expect(h.waits.slice(0, 3)).toEqual([CHECK_EVERY_MS, CHECK_EVERY_MS, CHECK_EVERY_MS]);
  expect(h.log).toEqual([]);
});

test("a daemon that stopped answering is started again, and says so", async () => {
  const h = harness([true, false, true], [true], 3);
  await keepAlive(h.d);
  expect(h.started()).toBe(1);
  expect(h.log).toEqual(["the daemon wasn't answering; started it again"]);
  expect(h.waits.slice(0, 3)).toEqual([CHECK_EVERY_MS, CHECK_EVERY_MS, CHECK_EVERY_MS]);
});

test("a daemon that won't start is retried with a growing wait, capped at 5 minutes, and the wait resets once it's back", async () => {
  const h = harness([false, false, false, false, false, false, false, false, true], [false, false, false, false, false, false, false, true], 10);
  await keepAlive(h.d);
  expect(h.waits.slice(0, 10)).toEqual([CHECK_EVERY_MS, 5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, CHECK_EVERY_MS, CHECK_EVERY_MS]);
  expect(retryAfter(20)).toBe(300_000);
  expect(h.log.at(-1)).toBe("the daemon wasn't answering; started it again");
});

test("nothing is started once the app is quitting", async () => {
  let quitting = false;
  let started = 0;
  await keepAlive({
    hello: async () => false,
    start: async () => {
      started++;
      return true;
    },
    log: () => {},
    stopped: () => quitting,
    wait: async () => void (quitting = true),
  });
  expect(started).toBe(0);
});
