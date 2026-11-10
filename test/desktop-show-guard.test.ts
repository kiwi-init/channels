import { expect, test } from "bun:test";
import { showWithin } from "../desktop/src/show-guard.ts";

test("a window whose page never gets ready is shown anyway after the wait, and main.log hears why (T1764)", async () => {
  const seen: string[] = [];
  let shown = false;
  const guard = showWithin(15, { shown: () => shown, show: () => void ((shown = true), seen.push("show")), late: (ms) => void seen.push(`late ${ms}`) });
  expect(seen).toEqual([]);
  await guard.waited;
  expect(seen).toEqual(["late 15", "show"]);
});

test("a window already on screen is left alone", async () => {
  const seen: string[] = [];
  const guard = showWithin(10, { shown: () => true, show: () => void seen.push("show"), late: () => void seen.push("late") });
  await guard.waited;
  expect(seen).toEqual([]);
});

test("a cancelled guard never shows", async () => {
  const seen: string[] = [];
  const guard = showWithin(10, { shown: () => false, show: () => void seen.push("show"), late: () => void seen.push("late") });
  guard.cancel();
  await new Promise((r) => setTimeout(r, 30));
  expect(seen).toEqual([]);
});
