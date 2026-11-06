import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { LayoutsView } from "../desktop/src/bridge.ts";
import { useHost } from "../desktop/src/host.ts";
import { layoutsCalls } from "../desktop/src/ipc/layouts.ts";
import { layoutOf, layoutsDir, readLayouts } from "../desktop/src/layout-folder.ts";
import { fakeHost } from "./fake-host.ts";

const homes: string[] = [];
const home = (): string => {
  const at = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-layouts-"));
  homes.push(at);
  return at;
};
afterEach(() => {
  for (const at of homes.splice(0)) fs.rmSync(at, { recursive: true, force: true });
});

const put = (dir: string, file: string, body: unknown) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), typeof body === "string" ? body : JSON.stringify(body));
};

const until = async (ok: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(20);
  }
};

describe("a layout file", () => {
  test("keeps its areas in order, its widths and its name; the file name stands in for a missing name", () => {
    expect(layoutOf("focus.json", { name: " Focus ", areas: ["chat", "panel", "rail"], widths: { panel: 520 } })).toEqual({
      file: "focus.json",
      name: "Focus",
      areas: ["chat", "panel", "rail"],
      widths: { panel: 520 },
    });
    expect(layoutOf("wide.json", { areas: ["rail", "sidebar", "chat"] })).toEqual({ file: "wide.json", name: "wide", areas: ["rail", "sidebar", "chat"], widths: {} });
  });

  test("says why it can't be used", () => {
    const why = (raw: unknown) => layoutOf("x.json", raw);
    expect(why([])).toBe("isn't a JSON object");
    expect(why({})).toBe('needs "areas", left to right, like ["rail", "sidebar", "chat", "panel"]');
    expect(why({ areas: ["chat", "dock"] })).toBe('has "dock" in "areas": the areas are rail, sidebar, chat and panel');
    expect(why({ areas: ["chat", "panel", "panel"] })).toBe('has "panel" twice in "areas"');
    expect(why({ areas: ["rail", "sidebar"] })).toBe('needs "chat" in "areas"');
    expect(why({ areas: ["sidebar", "rail", "chat"] })).toBe('puts "rail" between areas: it goes first or last');
    expect(why({ areas: ["chat"], widths: [280] })).toBe('"widths" isn\'t an object like { "sidebar": 280 }');
    expect(why({ areas: ["chat"], widths: { chat: 600 } })).toBe('has "widths.chat": only rail, sidebar and panel take a width');
    expect(why({ areas: ["chat"], widths: { sidebar: 100 } })).toBe('"widths.sidebar" isn\'t a whole number from 160 to 480');
    expect(why({ areas: ["chat"], widths: { panel: "400px" } })).toBe('"widths.panel" isn\'t a whole number from 320 to 760');
    expect(why({ areas: ["chat"], widths: { toString: 1 } })).toBe('has "widths.toString": only rail, sidebar and panel take a width');
  });

  test("a folder lists good layouts by file name and skips the rest with the reason", () => {
    const dir = layoutsDir(home());
    expect(readLayouts(dir)).toEqual({ dir, layouts: [], skipped: [] });
    put(dir, "b.json", { areas: ["chat"] });
    put(dir, "a.json", { areas: ["rail", "chat", "sidebar"] });
    put(dir, "bad.json", "{");
    put(dir, ".hidden.json", { areas: ["chat"] });
    put(dir, "notes.txt", "hi");
    expect(readLayouts(dir)).toEqual({
      dir,
      layouts: [
        { file: "a.json", name: "a", areas: ["rail", "chat", "sidebar"], widths: {} },
        { file: "b.json", name: "b", areas: ["chat"], widths: {} },
      ],
      skipped: [{ file: "bad.json", why: "isn't valid JSON" }],
    });
  });
});

describe("the layouts call", () => {
  test("the first call starts the watch, and a saved file is pushed to the page", async () => {
    const at = home();
    const shell = fakeHost();
    useHost(shell.host);
    const pushed: LayoutsView[] = [];
    const host = { ...shell.host, push: (name: string, value: unknown) => void (name === "layouts" && pushed.push(value as LayoutsView)) };
    const calls = layoutsCalls(host as typeof shell.host, () => at);
    expect((await calls.layouts()).layouts).toEqual([]);
    expect(fs.existsSync(layoutsDir(at))).toBe(true);
    await Bun.sleep(200);
    put(layoutsDir(at), "focus.json", { areas: ["chat", "panel"] });
    await until(() => pushed.some((v) => v.layouts.length === 1));
    expect(pushed.at(-1)?.layouts[0]?.areas).toEqual(["chat", "panel"]);
  });
});
