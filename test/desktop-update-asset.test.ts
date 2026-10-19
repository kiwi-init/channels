import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cantSwap, swapAsset, swapScript } from "../desktop/src/update-asset.ts";

test("a Mac swaps itself for the zip for its CPU", () => {
  expect(swapAsset("0.14.0", "darwin", "arm64")).toBe("Channels-0.14.0-mac-arm64.zip");
  expect(swapAsset("0.14.0", "darwin", "x64")).toBe("Channels-0.14.0-mac-x64.zip");
});

test("Linux and Windows never swap themselves: the update is only offered with the release link", () => {
  expect(swapAsset("0.14.0", "linux", "x64")).toBeNull();
  expect(swapAsset("0.14.0", "linux", "arm64")).toBeNull();
  expect(swapAsset("0.14.0", "win32", "x64")).toBeNull();
});

test("a Mac that's translocated, on its disk image, in a folder it can't write, or whose last swap of this version failed can't swap itself", () => {
  const ok = () => true;
  expect(cantSwap("/private/var/folders/x/AppTranslocation/ABC/d/Channels.app", ok, false)).toBe(true);
  expect(cantSwap("/Volumes/Channels 0.20.0/Channels.app", ok, false)).toBe(true);
  expect(cantSwap("/Applications/Channels.app", (dir) => dir !== "/Applications", false)).toBe(true);
  expect(cantSwap("/Applications/Channels.app", ok, true)).toBe(true);
  expect(cantSwap("/Applications/Channels.app", ok, false)).toBe(false);
});

function swapFixture(): { root: string; parent: string; target: string; next: string; dir: string; marker: string; pid: number } {
  const root = mkdtempSync(join(tmpdir(), "kiwi-swap-"));
  const parent = join(root, "Applications");
  const target = join(parent, "Channels.app");
  const dir = join(root, "download");
  const next = join(dir, "Channels.app");
  mkdirSync(target, { recursive: true });
  mkdirSync(next, { recursive: true });
  writeFileSync(join(target, "v"), "old");
  writeFileSync(join(next, "v"), "new");
  const done = Bun.spawnSync(["true"]);
  return { root, parent, target, next, dir, marker: join(root, "update-failed"), pid: done.pid };
}

test("a swap into a folder it can't write leaves the old app and a marker, so the next launch doesn't try that version again", () => {
  const f = swapFixture();
  try {
    chmodSync(f.parent, 0o555);
    const script = swapScript({ ...f, version: "0.20.0", relaunch: false });
    expect(Bun.spawnSync(["/bin/sh", "-c", script]).exitCode).toBe(0);
    expect(readFileSync(join(f.target, "v"), "utf8")).toBe("old");
    expect(readFileSync(f.marker, "utf8")).toBe("0.20.0");
    expect(existsSync(f.dir)).toBe(false);
  } finally {
    chmodSync(f.parent, 0o755);
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a swap that goes in replaces the app, clears an old marker and leaves no copy behind", () => {
  const f = swapFixture();
  try {
    writeFileSync(f.marker, "0.19.9");
    const script = swapScript({ ...f, version: "0.20.0", relaunch: false });
    expect(Bun.spawnSync(["/bin/sh", "-c", script]).exitCode).toBe(0);
    expect(readFileSync(join(f.target, "v"), "utf8")).toBe("new");
    expect(existsSync(f.marker)).toBe(false);
    expect(readdirSync(f.parent)).toEqual(["Channels.app"]);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
