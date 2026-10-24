import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { windowFailure } from "../desktop/src/main-log.ts";

const windowSource = readFileSync(join(import.meta.dir, "../desktop/src/window-eb.ts"), "utf8");

test("Electrobun's createWebview keeps none of its C strings alive, so the window is made right after a full collection, with the page's preload built before it, so making the window's strings can't start one that frees the secret key (#847)", () => {
  const made = windowSource.indexOf("const win = new BrowserWindow({");
  const collected = windowSource.lastIndexOf("Bun.gc(true);", made);
  const built = windowSource.lastIndexOf("const preload = preloadSource(", made);
  expect(made).toBeGreaterThan(-1);
  expect(collected).toBeGreaterThan(built);
  expect(built).toBeGreaterThan(-1);
  expect(windowSource.slice(collected + "Bun.gc(true);".length, made).trim()).toBe("");
  expect(windowSource.slice(made, windowSource.indexOf("});", made))).toContain("    preload,\n");
});

test("a window that can't start says what went wrong, to open Channels again, and where the details are", () => {
  const log = "/home/someone/.config/Channels/logs/main.log";
  const said = windowFailure("Failed to parse webview secret key byte: InvalidCharacter", log);
  expect(said).toContain("the window couldn't start (Failed to parse webview secret key byte: InvalidCharacter)");
  expect(said).toContain("Open Channels again");
  expect(said).toContain(log);
  expect(windowFailure(new Error("no display"), log)).toContain("(no display)");
});
