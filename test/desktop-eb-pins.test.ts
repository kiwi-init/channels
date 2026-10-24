import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import desktopPackage from "../desktop/package.json" with { type: "json" };
import { hostKey, mismatches, pinFor, PINS, sha256, treeSha256 } from "../desktop/scripts/eb-pins.ts";

const dirs: string[] = [];
const fresh = (): string => {
  const d = fs.mkdtempSync(path.join(tmpdir(), "eb-pins-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("Electrobun's toolchain and what it ships are pinned in the repo (T804)", () => {
  test("the pins move with the electrobun dependency", () => {
    expect(PINS.electrobun).toBe(desktopPackage.devDependencies.electrobun);
    for (const key of ["macos-arm64", "linux-x64", "linux-arm64"]) {
      const h = pinFor(PINS.hutch.platforms, key, "Hutch archive");
      expect(h.url).toBe(`https://github.com/blackboardsh/electrobun/releases/download/v${PINS.electrobun}/electrobun-hutch-${key}.tar.gz`);
      expect(h.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.keys(h.files).sort()).toEqual(["bin/hutch", "bin/hutch-engine", "hutch-release.json"]);
    }
    expect(Object.keys(pinFor(PINS.app, "macos-arm64", "app files"))).toContain("Contents/MacOS/libNativeWrapper.dylib");
    expect(pinFor(PINS.devkit, "macos-arm64", "devkit")).toMatch(/^[0-9a-f]{64}$/);
    for (const key of ["linux-x64", "linux-arm64"]) expect(pinFor(PINS.devkit, key, "devkit")).toBe(pinFor(PINS.devkit, "macos-arm64", "devkit"));
  });

  test("Linux's native wrapper is built from pinned Electrobun source, CEF and Dawn headers and one patch (T523)", () => {
    const { source, cef, dawn } = PINS.nativeWrapper;
    const commit = /^https:\/\/codeload\.github\.com\/blackboardsh\/electrobun\/tar\.gz\/([0-9a-f]{40})$/.exec(source.url)?.[1];
    expect(commit).toBeString();
    expect(source.keep).toBe(`electrobun-${commit}/package/src/native`);
    expect(cef.url).toStartWith("https://cef-builds.spotifycdn.com/cef_binary_");
    expect(cef.keep).toEndWith("_linux64_minimal/include");
    expect(dawn.url).toStartWith("https://electrobun-artifacts.blackboard.sh/electrobun-dawn/releases/");
    expect(dawn.keep).toBe("linux-x64/include");
    for (const pin of [source, cef, dawn]) expect(pin.tree).toMatch(/^[0-9a-f]{64}$/);
    const patch = fs.readFileSync(path.join(import.meta.dirname, "..", "desktop", "native", "linux", "electrobun-wayland.patch"), "utf8");
    expect(patch.match(/^\+\+\+ .*$/gm)).toEqual(["+++ b/package/src/native/linux/nativeWrapper.cpp"]);
    expect(patch).toContain('\n-            setenv("GDK_BACKEND", "x11", 1);\n');
    expect(patch).toContain('\n+            if (isCEFAvailable()) {\n+                setenv("GDK_BACKEND", "x11", 1);\n+            }\n');
  });

  test("a host without pins is refused by name", () => {
    expect(() => pinFor(PINS.app, "linux-x64", "app files")).toThrow("pins no app files for linux-x64");
    expect(hostKey("darwin", "arm64")).toBe("macos-arm64");
    expect(hostKey("linux", "x64")).toBe("linux-x64");
    expect(() => hostKey("win32", "x64")).toThrow("doesn't build on win32-x64");
  });

  test("a file that changed, went missing or was swapped is named", () => {
    const d = fresh();
    fs.mkdirSync(path.join(d, "bin"));
    fs.writeFileSync(path.join(d, "bin", "a"), "one");
    const want = { "bin/a": sha256(new TextEncoder().encode("one")), "bin/b": sha256(new TextEncoder().encode("two")) };
    expect(mismatches(d, want)).toEqual(["bin/b: missing"]);
    fs.writeFileSync(path.join(d, "bin", "b"), "tw0");
    expect(mismatches(d, want)).toEqual([`bin/b: ${sha256(new TextEncoder().encode("tw0"))}, pinned ${want["bin/b"]}`]);
  });

  test("a tree's hash covers every file's path and bytes, in any order of creation", () => {
    const a = fresh();
    const b = fresh();
    fs.mkdirSync(path.join(a, "x"));
    fs.writeFileSync(path.join(a, "x", "1.ts"), "one");
    fs.writeFileSync(path.join(a, "2.ts"), "two");
    fs.writeFileSync(path.join(b, "2.ts"), "two");
    fs.mkdirSync(path.join(b, "x"));
    fs.writeFileSync(path.join(b, "x", "1.ts"), "one");
    expect(treeSha256(a)).toBe(treeSha256(b));
    fs.renameSync(path.join(b, "x", "1.ts"), path.join(b, "x", "3.ts"));
    expect(treeSha256(a)).not.toBe(treeSha256(b));
    fs.renameSync(path.join(b, "x", "3.ts"), path.join(b, "x", "1.ts"));
    fs.writeFileSync(path.join(b, "x", "1.ts"), "0ne");
    expect(treeSha256(a)).not.toBe(treeSha256(b));
    fs.symlinkSync(path.join(a, "2.ts"), path.join(a, "link"));
    expect(() => treeSha256(a)).toThrow("neither a file nor a folder");
  });
});
