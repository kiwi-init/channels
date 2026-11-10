import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startupLine } from "../desktop/src/eb-startup.ts";
import { useHost } from "../desktop/src/host.ts";
import { logMainLine } from "../desktop/src/main-log.ts";
import { fakeHost } from "./fake-host.ts";

const logs = mkdtempSync(join(tmpdir(), "kiwi-startup-line-"));
useHost(fakeHost({ paths: { logs } }).host);

test("the startup line lists every mark in the order it happened, in ms since Bun started (T2678)", () => {
  const t0 = 1_800_000_000_000;
  const line = startupLine({ bun: t0, webview: t0 + 397.4, main: t0 + 222, store: t0 + 1_930, window: t0 + 1_934.6, committed: t0 + 3_300 });
  expect(line).toBe("startup, ms since Bun started: bun 0, main 222, webview 397, store 1930, window 1935, committed 3300");
});

test("it holds only mark names and numbers: no path, no key, nothing of the person's", () => {
  const line = startupLine({ bun: 5, main: 80, store: 90, window: 95, webview: 240, rules: 240, canary: 1500, load: 1501, committed: 1660, domReady: 2000, uiReady: 2100, tray: 4000 });
  expect(line).toMatch(/^startup, ms since Bun started: ([a-zA-Z]+ \d+(, )?)+$/);
});

test("with no marks it says so instead of a line of NaN", () => {
  expect(startupLine({})).toBe("startup: no marks");
});

test("a line goes to main.log with its time, on one line", () => {
  logMainLine("startup, ms since Bun started: bun 0,\n main 222", new Date("2026-11-10T03:00:00.000Z"));
  const file = join(logs, "main.log");
  expect(existsSync(file)).toBe(true);
  expect(readFileSync(file, "utf8")).toBe("2026-11-10T03:00:00.000Z startup, ms since Bun started: bun 0, main 222\n");
});
