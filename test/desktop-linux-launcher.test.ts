import { afterAll, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ELECTROBUN_LAUNCHER } from "../desktop/scripts/linux-files.ts";

const linux = process.platform === "linux";
const root = mkdtempSync(join(tmpdir(), "kiwi-linux-launcher-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function launcherBeside(name: string, standIn: string): string {
  const bin = join(root, name);
  mkdirSync(bin, { recursive: true });
  execFileSync("cc", ["-O2", "-Wall", "-Wextra", "-Werror", "-o", join(bin, "launcher"), join(import.meta.dir, "../desktop/native/linux/kiwi-launcher.c")]);
  copyFileSync(standIn, join(bin, ELECTROBUN_LAUNCHER));
  return join(bin, "launcher");
}

const POLLUTED = {
  HOME: "/home/ana",
  PATH: "/usr/bin:/bin",
  DISPLAY: ":0",
  WAYLAND_DISPLAY: "wayland-0",
  XDG_RUNTIME_DIR: "/run/user/1000",
  DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
  LC_ALL: "pt_BR.UTF-8",
  GTK_IM_MODULE: "fcitx",
  WEBKIT_DISABLE_DMABUF_RENDERER: "1",
  APPIMAGE: "/home/ana/Channels.AppImage",
  https_proxy: "http://proxy:3128",
  LD_PRELOAD: "/tmp/evil.so",
  LD_LIBRARY_PATH: ".",
  BUN_OPTIONS: "--preload=/tmp/evil.ts",
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: "/tmp/cache",
  NODE_OPTIONS: "--require=/tmp/evil.js",
  JSC_useJIT: "false",
  GTK_MODULES: "evil",
  GTK_PATH: "/tmp/gtk",
  GIO_MODULE_DIR: "/tmp/gio",
  GST_PLUGIN_PATH: "/tmp/gst",
  QT_PLUGIN_PATH: "/tmp/qt",
  WEBKIT_INJECTED_BUNDLE_PATH: "/tmp/bundle",
  KIWI_KEY_FD: "3",
  SOMETHING_ELSE: "x",
};

test.skipIf(!linux)("the Linux launcher hands Electrobun's launcher only the names it keeps, and sets the transpiler-cache switch itself, whatever it was given (T1548)", () => {
  const launcher = launcherBeside("env", "/usr/bin/env");
  const seen = execFileSync(launcher, [], { env: POLLUTED, encoding: "utf8" }).trim().split("\n");
  expect(seen).toEqual([
    "HOME=/home/ana",
    "PATH=/usr/bin:/bin",
    "DISPLAY=:0",
    "WAYLAND_DISPLAY=wayland-0",
    "XDG_RUNTIME_DIR=/run/user/1000",
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus",
    "LC_ALL=pt_BR.UTF-8",
    "GTK_IM_MODULE=fcitx",
    "WEBKIT_DISABLE_DMABUF_RENDERER=1",
    "APPIMAGE=/home/ana/Channels.AppImage",
    "https_proxy=http://proxy:3128",
    "BUN_RUNTIME_TRANSPILER_CACHE_PATH=0",
  ]);
});

test.skipIf(!linux)("started through a link elsewhere (/usr/bin/channels-desktop), it still starts the Electrobun launcher beside itself, with the arguments it was given (T1548)", () => {
  const launcher = launcherBeside("echo", "/bin/echo");
  const links = join(root, "usr-bin");
  mkdirSync(links, { recursive: true });
  symlinkSync(launcher, join(links, "channels-desktop"));
  const ran = spawnSync(join(links, "channels-desktop"), ["kiwi://join/abc", "--second"], { env: { PATH: "/usr/bin:/bin" }, encoding: "utf8" });
  expect({ status: ran.status, out: ran.stdout.trim() }).toEqual({ status: 0, out: "kiwi://join/abc --second" });
});

test.skipIf(!linux)("with no Electrobun launcher beside it, it says so and starts nothing (T1548)", () => {
  const bin = join(root, "alone");
  mkdirSync(bin, { recursive: true });
  execFileSync("cc", ["-O2", "-o", join(bin, "launcher"), join(import.meta.dir, "../desktop/native/linux/kiwi-launcher.c")]);
  const ran = spawnSync(join(bin, "launcher"), [], { env: {}, encoding: "utf8" });
  expect(ran.status).toBe(127);
  expect(ran.stderr).toContain("can't start the app");
});
