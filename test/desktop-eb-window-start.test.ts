import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIRST_PRELOAD } from "../desktop/src/eb-bridge.ts";
import { windowFailure } from "../desktop/src/main-log.ts";

const windowSource = readFileSync(join(import.meta.dir, "../desktop/src/window-eb.ts"), "utf8");

test("Electrobun's createWebview keeps none of its C strings alive, so the window is made with a preload of a few bytes and the page's own goes in by setPreload before anything loads (#847)", () => {
  expect(new TextEncoder().encode(FIRST_PRELOAD).length).toBeLessThanOrEqual(8);
  const made = windowSource.indexOf("new BrowserWindow({");
  const options = windowSource.slice(made, windowSource.indexOf("});", made));
  expect(options).toContain("preload: FIRST_PRELOAD,");
  expect(options).not.toContain("preloadSource(");
  const set = windowSource.indexOf("refreshPreload();", made);
  expect(set).toBeGreaterThan(made);
  expect(set).toBeLessThan(windowSource.indexOf("await rulesHold(webview)"));
  expect(set).toBeLessThan(windowSource.indexOf("load(first);"));
});

test("a window that can't start says what went wrong, to open Channels again, and where the details are", () => {
  const log = "/home/someone/.config/Channels/logs/main.log";
  const said = windowFailure("Failed to parse webview secret key byte: InvalidCharacter", log);
  expect(said).toContain("the window couldn't start (Failed to parse webview secret key byte: InvalidCharacter)");
  expect(said).toContain("Open Channels again");
  expect(said).toContain(log);
  expect(windowFailure(new Error("no display"), log)).toContain("(no display)");
});
