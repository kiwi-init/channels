import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cantSwap, debAsset, relaunchAfter, swapAsset, swapScript } from "../desktop/src/update-asset.ts";

test("a Mac swaps itself for the zip for its CPU", () => {
  expect(swapAsset("0.14.0", "darwin", "arm64")).toBe("Channels-0.14.0-mac-arm64.zip");
  expect(swapAsset("0.14.0", "darwin", "x64")).toBe("Channels-0.14.0-mac-x64.zip");
});

test("an AppImage swaps itself for the AppImage for its CPU (T1554)", () => {
  expect(swapAsset("0.27.0", "linux", "x64", "/home/a/Applications/Channels.AppImage")).toBe("Channels-0.27.0-linux-x86_64.AppImage");
  expect(swapAsset("0.27.0", "linux", "arm64", "/home/a/Applications/Channels.AppImage")).toBe("Channels-0.27.0-linux-aarch64.AppImage");
  expect(swapAsset("0.27.0", "linux", "ia32", "/home/a/Applications/Channels.AppImage")).toBeNull();
});

test("a deb install and Windows never swap themselves; a deb install is offered the release's .deb for its CPU (T1554)", () => {
  expect(swapAsset("0.27.0", "linux", "x64")).toBeNull();
  expect(swapAsset("0.27.0", "win32", "x64")).toBeNull();
  expect(debAsset("0.27.0", "linux", "x64")).toBe("Channels-0.27.0-linux-amd64.deb");
  expect(debAsset("0.27.0", "linux", "arm64")).toBe("Channels-0.27.0-linux-arm64.deb");
  expect(debAsset("0.27.0", "linux", "x64", "/home/a/Channels.AppImage")).toBeNull();
  expect(debAsset("0.27.0", "darwin", "arm64")).toBeNull();
  expect(debAsset("0.27.0", "win32", "x64")).toBeNull();
});

test("a relaunch waits for this process to end, then starts the app without the old AppImage's environment (T1554)", async () => {
  const root = mkdtempSync(join(tmpdir(), "kiwi-relaunch-"));
  try {
    const out = join(root, "env");
    const exe = join(root, "app.sh");
    writeFileSync(exe, `#!/bin/sh\nenv > '${out}'\n`);
    chmodSync(exe, 0o755);
    const alive = Bun.spawn(["sleep", "1"]);
    const after = relaunchAfter(alive.pid, exe, {
      PATH: process.env["PATH"],
      HOME: "/home/a",
      APPIMAGE: "/home/a/Channels.AppImage",
      APPDIR: "/tmp/.mount_old",
      ARGV0: "Channels.AppImage",
      OWD: "/home/a",
      LD_LIBRARY_PATH: "/tmp/.mount_old/Channels/bin",
      LD_PRELOAD: "/tmp/x.so",
    });
    const sh = Bun.spawn(["/bin/sh", ...after.args], { env: after.env });
    await Bun.sleep(400);
    expect(existsSync(out)).toBe(false);
    await alive.exited;
    await sh.exited;
    const env = readFileSync(out, "utf8");
    expect(env).toContain("HOME=/home/a");
    for (const name of ["APPIMAGE", "APPDIR", "ARGV0", "OWD", "LD_LIBRARY_PATH", "LD_PRELOAD"]) expect(env).not.toMatch(new RegExp(`^${name}=`, "m"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
