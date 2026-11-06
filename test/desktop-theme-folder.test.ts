import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { FolderThemesView } from "../desktop/src/bridge.ts";
import { useHost } from "../desktop/src/host.ts";
import { themesCalls } from "../desktop/src/ipc/themes.ts";
import { MAX_THEME_BYTES, readFolder, removeTheme, themeOf, themesDir, watchFolder, writeTheme } from "../desktop/src/theme-folder.ts";
import { fakeHost } from "./fake-host.ts";

const homes: string[] = [];
const home = (): string => {
  const at = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-themes-"));
  homes.push(at);
  return at;
};
afterEach(() => {
  for (const at of homes.splice(0)) fs.rmSync(at, { recursive: true, force: true });
});

const dusk = { name: "Dusk", appearance: "dark", base: { background: "#15131A", text: "#e8e2f0", accent: "#f0a86b" } };

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

describe("themes in ~/.kiwi/themes/", () => {
  test("a valid file loads with its name, appearance and colours, lower-cased", () => {
    const dir = themesDir(home());
    put(dir, "dusk.json", { ...dusk, base: { ...dusk.base, red: "#FF0000", unknown: "#000000" } });
    expect(readFolder(dir)).toEqual({
      dir,
      themes: [{ file: "dusk.json", name: "Dusk", appearance: "dark", base: { background: "#15131a", text: "#e8e2f0", accent: "#f0a86b", red: "#ff0000" } }],
      skipped: [],
    });
  });

  test("a theme without a name is named after its file", () => {
    const dir = themesDir(home());
    put(dir, "sea-glass.json", { appearance: "light", base: { background: "#f4f8f7", text: "#10201c", accent: "#2a9d8f" } });
    expect(readFolder(dir).themes.map((t) => t.name)).toEqual(["sea-glass"]);
  });

  test("each bad file is skipped with the reason Settings shows, and the good ones still load", () => {
    const dir = themesDir(home());
    put(dir, "a-not-json.json", "{ name: Dusk");
    put(dir, "b-array.json", [dusk]);
    put(dir, "c-no-appearance.json", { ...dusk, appearance: "dim" });
    put(dir, "d-no-base.json", { name: "x", appearance: "dark" });
    put(dir, "e-no-accent.json", { ...dusk, base: { background: "#000000", text: "#ffffff" } });
    put(dir, "f-short-hex.json", { ...dusk, base: { ...dusk.base, green: "#0f0" } });
    put(dir, "g-big.json", JSON.stringify({ ...dusk, pad: "x".repeat(MAX_THEME_BYTES) }));
    put(dir, "h-good.json", dusk);
    put(dir, ".hidden.json", dusk);
    put(dir, "notes.txt", "not a theme");
    const view = readFolder(dir);
    expect(view.themes.map((t) => t.file)).toEqual(["h-good.json"]);
    expect(view.skipped).toEqual([
      { file: "a-not-json.json", why: "isn't valid JSON" },
      { file: "b-array.json", why: "isn't a JSON object" },
      { file: "c-no-appearance.json", why: 'needs "appearance": "dark" or "light"' },
      { file: "d-no-base.json", why: 'needs a "base" object with background, text and accent' },
      { file: "e-no-accent.json", why: 'needs "base.accent", a colour like #1a2b3c' },
      { file: "f-short-hex.json", why: '"base.green" isn\'t a colour like #1a2b3c' },
      { file: "g-big.json", why: "is over 64 KB" },
    ]);
  });

  test("no folder reads as no themes, and nothing is created by reading", () => {
    const dir = themesDir(home());
    expect(readFolder(dir)).toEqual({ dir, themes: [], skipped: [] });
    expect(fs.existsSync(dir)).toBe(false);
  });

  test("saving names a new file after the theme, never overwrites another, and rewrites a named one in place", () => {
    const dir = themesDir(home());
    expect(writeTheme(dir, null, { name: "My Dusk!", appearance: "dark", base: dusk.base })).toBe("my-dusk.json");
    expect(writeTheme(dir, null, { name: "My Dusk!", appearance: "dark", base: dusk.base })).toBe("my-dusk-2.json");
    expect(writeTheme(dir, "my-dusk.json", { name: "My Dusk", appearance: "light", base: { ...dusk.base, accent: "#112233" } })).toBe("my-dusk.json");
    const view = readFolder(dir);
    expect(view.themes.map((t) => [t.file, t.name, t.appearance, t.base.accent])).toEqual([
      ["my-dusk-2.json", "My Dusk!", "dark", "#f0a86b"],
      ["my-dusk.json", "My Dusk", "light", "#112233"],
    ]);
    expect(fs.readdirSync(dir).sort()).toEqual(["my-dusk-2.json", "my-dusk.json"]);
    expect(fs.readFileSync(path.join(dir, "my-dusk.json"), "utf8")).toEndWith("}\n");
  });

  test("saving and removing refuse a path outside the folder and a bad theme", () => {
    const dir = themesDir(home());
    for (const file of ["../x.json", "a/b.json", ".dot.json", "x.txt", "x"]) {
      expect(() => writeTheme(dir, file, { name: "x", appearance: "dark", base: dusk.base })).toThrow("plain name ending in .json");
      expect(() => removeTheme(dir, file)).toThrow("plain name ending in .json");
    }
    expect(() => writeTheme(dir, null, { name: "x", appearance: "dark", base: { ...dusk.base, text: "white" } })).toThrow('that theme "base.text" isn\'t a colour');
    expect(themeOf("x.json", { name: "x", appearance: "dark", base: { ...dusk.base, text: 7 } })).toBe('"base.text" isn\'t a colour like #1a2b3c');
  });

  test("watching makes the folder and calls back once for a burst of changes", async () => {
    const dir = themesDir(home());
    let calls = 0;
    const stop = watchFolder(
      dir,
      () => calls++,
      () => {},
    );
    expect(fs.existsSync(dir)).toBe(true);
    await Bun.sleep(200);
    put(dir, "one.json", dusk);
    put(dir, "two.json", dusk);
    put(dir, "one.json", { ...dusk, name: "One" });
    await until(() => calls > 0);
    await Bun.sleep(300);
    expect(calls).toBe(1);
    stop();
    put(dir, "three.json", dusk);
    await Bun.sleep(300);
    expect(calls).toBe(1);
  });
});

describe("the themes calls", () => {
  test("the first call starts the watch, a new file is pushed to the page, and save and delete answer with the folder", async () => {
    const at = home();
    const shell = fakeHost();
    useHost(shell.host);
    const pushed: FolderThemesView[] = [];
    const host = { ...shell.host, push: (name: string, value: unknown) => void (name === "folderThemes" && pushed.push(value as FolderThemesView)) };
    const calls = themesCalls(host as typeof shell.host, () => at);
    expect((await calls.folderThemes()).themes).toEqual([]);
    await Bun.sleep(200);
    put(themesDir(at), "dusk.json", dusk);
    await until(() => pushed.some((v) => v.themes.length === 1));
    expect(pushed.at(-1)?.themes[0]?.name).toBe("Dusk");
    const saved = await calls.saveFolderTheme(null, { name: "Moss", appearance: "light", base: { background: "#f0f4ec", text: "#1d2a17", accent: "#5a8f3c" } });
    expect(saved.file).toBe("moss.json");
    expect(saved.view.themes.map((t) => t.file)).toEqual(["dusk.json", "moss.json"]);
    expect((await calls.deleteFolderTheme("dusk.json")).themes.map((t) => t.file)).toEqual(["moss.json"]);
  });
});
