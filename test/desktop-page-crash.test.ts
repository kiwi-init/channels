import { describe, expect, test } from "bun:test";

import { keepPageAlive } from "../desktop/src/page-crash.ts";

function keeper(answer: boolean) {
  const seen = { reloads: 0, quits: 0, asked: [] as string[], logged: [] as string[], t: 0, quitting: false };
  let release: () => void = () => {};
  const gone = keepPageAlive({
    reload: () => void seen.reloads++,
    ask: (message) => {
      seen.asked.push(message);
      return new Promise((ok) => (release = () => ok(answer)));
    },
    quit: () => void seen.quits++,
    log: (e) => void seen.logged.push(e.message),
    quitting: () => seen.quitting,
    now: () => seen.t,
  });
  return { seen, gone, answer: () => release() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the Electrobun window's page, when its web content process ends (T439)", () => {
  test("three ends in a minute reload by themselves, each written to the log; the fourth asks, and Reload reloads", async () => {
    const k = keeper(true);
    for (const at of [0, 1_000, 2_000]) {
      k.seen.t = at;
      k.gone("its web content process ended");
    }
    expect(k.seen.reloads).toBe(3);
    expect(k.seen.asked).toEqual([]);
    k.seen.t = 3_000;
    k.gone("its web content process ended");
    expect(k.seen.asked).toEqual(["Channels' window keeps stopping."]);
    expect(k.seen.reloads).toBe(3);
    k.answer();
    await tick();
    expect(k.seen.reloads).toBe(4);
    expect(k.seen.logged).toEqual(Array(4).fill("the window's page stopped (its web content process ended)"));
  });

  test("Quit quits, and while the question is open another end doesn't ask again", async () => {
    const k = keeper(false);
    for (const at of [0, 1, 2, 3, 4]) {
      k.seen.t = at;
      k.gone("its web content process ended");
    }
    expect(k.seen.asked.length).toBe(1);
    k.answer();
    await tick();
    expect(k.seen.quits).toBe(1);
    expect(k.seen.reloads).toBe(3);
  });

  test("ends older than a minute don't count, and none count while the app is quitting", () => {
    const k = keeper(true);
    for (const at of [0, 1_000, 2_000, 63_000]) {
      k.seen.t = at;
      k.gone("its web content process ended");
    }
    expect(k.seen.reloads).toBe(4);
    expect(k.seen.asked).toEqual([]);
    k.seen.quitting = true;
    k.gone("its web content process ended");
    expect(k.seen.reloads).toBe(4);
    expect(k.seen.logged.length).toBe(4);
  });
});
