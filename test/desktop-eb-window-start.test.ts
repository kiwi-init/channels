import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
