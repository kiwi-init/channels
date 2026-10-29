import { expect, test } from "bun:test";

import { nudgeOnWake } from "./wake";

test("coming back online or to a visible page nudges; a hidden page and a stopped listener don't", () => {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "hidden" as DocumentVisibilityState });
  let nudges = 0;
  const stop = nudgeOnWake(() => nudges++, win as unknown as Window, doc as unknown as Document);
  win.dispatchEvent(new Event("online"));
  expect(nudges).toBe(1);
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(nudges).toBe(1);
  doc.visibilityState = "visible";
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(nudges).toBe(2);
  stop();
  win.dispatchEvent(new Event("online"));
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(nudges).toBe(2);
});
