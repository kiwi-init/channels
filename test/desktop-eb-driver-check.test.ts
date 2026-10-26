import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { linuxLayout, macLayout, marksOf, releaseProblems, testEnvProblem } from "../desktop/scripts/eb-test-marks.ts";

const root = mkdtempSync(join(tmpdir(), "kiwi-eb-driver-check-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const MAIN = "var page = 'views://internal/index.html'; function restoreWindowFocusAfterExternalDrop() {}";
const LAUNCHER = "\x7fELF\0setenv\0BUN_RUNTIME_TRANSPILER_CACHE_PATH\0HOME\0";
const has = (bin: string): boolean => Bun.spawnSync(["sh", "-c", `command -v ${bin}`]).exitCode === 0;

function macApp(name: string, main = MAIN, launcher = LAUNCHER, view = "export const x = 1;"): string {
  const app = join(root, name, "Channels.app");
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  mkdirSync(join(app, "Contents", "Resources", "app", "bun"), { recursive: true });
  mkdirSync(join(app, "Contents", "Resources", "app", "views", "internal"), { recursive: true });
  writeFileSync(join(app, "Contents", "Info.plist"), "<plist><dict><key>CFBundleExecutable</key>\n\t<string>launcher</string></dict></plist>");
  writeFileSync(join(app, "Contents", "MacOS", "launcher"), launcher);
  writeFileSync(join(app, "Contents", "Resources", "app", "bun", "index.js"), main);
  writeFileSync(join(app, "Contents", "Resources", "app", "views", "internal", "page.js"), view);
  return app;
}

function linuxTree(name: string, main = MAIN, launcher = LAUNCHER): string {
  const tree = join(root, name);
  const app = join(tree, "Channels");
  mkdirSync(join(app, "bin"), { recursive: true });
  mkdirSync(join(app, "Resources", "app", "bun"), { recursive: true });
  writeFileSync(join(app, "bin", "launcher"), launcher);
  writeFileSync(join(app, "Resources", "app", "bun", "index.js"), main);
  return tree;
}

test("a release app with none of the test-only names passes, read from the files a Mac app and an extracted AppImage keep them in (T445)", () => {
  const mac = macLayout(macApp("clean"));
  expect(mac.launcher.endsWith(join("Contents", "MacOS", "launcher"))).toBe(true);
  expect(releaseProblems("the zip", marksOf(mac))).toEqual([]);
  const linux = linuxLayout(join(linuxTree("clean-linux"), "Channels"));
  expect(releaseProblems("the AppImage", marksOf(linux))).toEqual([]);
});

test("test-only code fails it, in the main bundle, in a page script, or let through by the launcher (T445)", () => {
  expect(releaseProblems("the zip", marksOf(macLayout(macApp("relay", `${MAIN}; process.env.KIWI_EB_RELAY`))))).toEqual(["the zip carries test-only code: KIWI_EB_RELAY"]);
  expect(releaseProblems("the dmg", marksOf(macLayout(macApp("view", MAIN, LAUNCHER, "window.kiwiDriver = {};"))))).toEqual(["the dmg carries test-only code: kiwiDriver"]);
  expect(releaseProblems("the AppImage", marksOf(linuxLayout(join(linuxTree("home", MAIN, `${LAUNCHER}KIWI_HOME\0`), "Channels"))))).toEqual([
    "the AppImage carries test-only code: KIWI_HOME through its launcher",
  ]);
});

test("files that lack what every build has fail it as unread, so a check of the wrong files can't pass (T445)", () => {
  expect(releaseProblems("the AppImage", marksOf(linuxLayout(join(linuxTree("empty", "var x = 1;", "\x7fELF\0"), "Channels"))))).toEqual([
    "the AppImage lacks views://internal/index.html, restoreWindowFocusAfterExternalDrop, BUN_RUNTIME_TRANSPILER_CACHE_PATH in its launcher, which every build has, so the check read the wrong files and proves nothing",
  ]);
  const plain = join(root, "no-exe", "Channels.app");
  mkdirSync(join(plain, "Contents"), { recursive: true });
  writeFileSync(join(plain, "Contents", "Info.plist"), "<plist><dict></dict></plist>");
  expect(() => macLayout(plain)).toThrow("names no CFBundleExecutable");
});

test("a release job with CHANNELS_EB_TEST set fails before reading anything (T445)", () => {
  expect(testEnvProblem({})).toBeNull();
  expect(testEnvProblem({ CHANNELS_EB_TEST: "" })).toBeNull();
  expect(testEnvProblem({ CHANNELS_EB_TEST: "1" })).toContain("a release never sets it");
  const r = Bun.spawnSync(["bun", "desktop/scripts/eb-driver-check.ts", "--release", join(root, "Channels-1.0.0-linux-x86_64.AppImage")], { env: { ...process.env, CHANNELS_EB_TEST: "1" } });
  expect({ code: r.exitCode, err: r.stderr.toString() }).toEqual({ code: 1, err: expect.stringContaining("CHANNELS_EB_TEST is set") });
});

test("--release refuses a file it can't read, and asks for at least one (T445)", () => {
  const env = { ...process.env, CHANNELS_EB_TEST: "" };
  const odd = join(root, "Channels.tar");
  writeFileSync(odd, "");
  const r = Bun.spawnSync(["bun", "desktop/scripts/eb-driver-check.ts", "--release", odd], { env });
  expect({ code: r.exitCode, err: r.stderr.toString() }).toEqual({ code: 1, err: expect.stringContaining("isn't a .zip, .dmg or .AppImage") });
  const none = Bun.spawnSync(["bun", "desktop/scripts/eb-driver-check.ts", "--release"], { env });
  expect({ code: none.exitCode, err: none.stderr.toString() }).toEqual({ code: 1, err: expect.stringContaining("usage:") });
});

test("--release extracts an AppImage and reads its Channels folder: a clean one passes, one carrying the test store fails (T445)", () => {
  const imageOf = (name: string, main: string): string => {
    const tree = linuxTree(name, main);
    const image = join(root, `${name}.AppImage`);
    writeFileSync(image, `#!/bin/sh\n[ "$1" = --appimage-extract ] || exit 2\ncp -R '${tree}' squashfs-root\n`);
    return image;
  };
  const run = (image: string) => Bun.spawnSync(["bun", "desktop/scripts/eb-driver-check.ts", "--release", image], { env: { ...process.env, CHANNELS_EB_TEST: "" } });
  const clean = run(imageOf("image-clean", MAIN));
  expect({ code: clean.exitCode, out: clean.stdout.toString() }).toEqual({ code: 0, out: expect.stringContaining("image-clean.AppImage: no test driver") });
  const dirty = run(imageOf("image-dirty", `${MAIN}; "kiwi-eb-test-store.json"`));
  expect({ code: dirty.exitCode, err: dirty.stderr.toString() }).toEqual({ code: 1, err: expect.stringContaining("image-dirty.AppImage carries test-only code: kiwi-eb-test-store.json") });
});

test.skipIf(!has("ditto"))("--release reads a real .zip made the way eb-release.ts makes it (T445)", () => {
  const app = macApp("zip-clean");
  const zip = join(root, "Channels-1.0.0-mac-arm64.zip");
  expect(Bun.spawnSync(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]).exitCode).toBe(0);
  const r = Bun.spawnSync(["bun", "desktop/scripts/eb-driver-check.ts", "--release", zip], { env: { ...process.env, CHANNELS_EB_TEST: "" } });
  expect({ code: r.exitCode, out: r.stdout.toString() }).toEqual({ code: 0, out: expect.stringContaining("Channels-1.0.0-mac-arm64.zip: no test driver") });
});
