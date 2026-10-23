import { expect, test } from "bun:test";

import { TRAY_AFTER_READY_MS, TRAY_LATEST_MS, trayLater } from "../desktop/src/tray-later.ts";

function harness() {
  const timers: { f: () => void; ms: number }[] = [];
  const ready: (() => void)[] = [];
  const made: string[] = [];
  const refreshed: string[] = [];
  const tray = trayLater({
    make: (u: string) => {
      made.push(u);
      return { refresh: (v) => void refreshed.push(v) };
    },
    update: "none",
    onReady: (f) => void ready.push(f),
    later: (f, ms) => void timers.push({ f, ms }),
  });
  const fire = (ms: number) => {
    for (const t of timers.filter((x) => x.ms === ms)) t.f();
  };
  return { tray, timers, ready, made, refreshed, fire };
}

test("the tray isn't made at start: it comes 2 s after the page's dom-ready, once, with the latest update state (T798)", () => {
  const h = harness();
  expect(h.made).toEqual([]);
  h.tray.refresh("available");
  expect(h.refreshed).toEqual([]);
  for (const f of h.ready) f();
  for (const f of h.ready) f();
  expect(h.made).toEqual([]);
  expect(h.timers.filter((t) => t.ms === TRAY_AFTER_READY_MS).length).toBe(2);
  h.fire(TRAY_AFTER_READY_MS);
  h.fire(TRAY_LATEST_MS);
  expect(h.made).toEqual(["available"]);
  h.tray.refresh("ready");
  expect(h.refreshed).toEqual(["ready"]);
});

test("a page that never reaches dom-ready still gets its tray 10 s after start (T798)", () => {
  const h = harness();
  h.fire(TRAY_LATEST_MS);
  expect(h.made).toEqual(["none"]);
});
