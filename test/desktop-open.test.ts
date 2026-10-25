import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { externalUrl, type ExternalUrl } from "../desktop/src/guard.ts";
import { browserEnv, openInBrowser, type Launch } from "../desktop/src/open.ts";

function web(url: string): ExternalUrl {
  const checked = externalUrl(url);
  if (!checked) throw new Error(`${url} is not a web link`);
  return checked;
}

const KIWI_ENV = {
  PATH: "/usr/bin",
  HOME: "/home/a",
  DISPLAY: ":0",
  WAYLAND_DISPLAY: "wayland-0",
  XDG_CURRENT_DESKTOP: "GNOME",
  CHROME_DESKTOP: "channels-desktop.desktop",
  GIO_LAUNCHED_DESKTOP_FILE: "/usr/share/applications/channels-desktop.desktop",
  GIO_LAUNCHED_DESKTOP_FILE_PID: "42",
  BAMF_DESKTOP_FILE_HINT: "/usr/share/applications/channels-desktop.desktop",
  APPIMAGE: "/home/a/Channels.AppImage",
  APPDIR: "/tmp/.mount_Channels",
  ARGV0: "Channels.AppImage",
  OWD: "/home/a",
  ELECTRON_RUN_AS_NODE: "1",
  LD_LIBRARY_PATH: ".",
  BUN_OPTIONS: "--preload=/tmp/evil.ts",
  NODE_OPTIONS: "--require=/tmp/evil.js",
  KIWI_KEY_FD: "3",
};

function fakeLaunch(fail = false, missing: readonly string[] = fail ? ["xdg-open", "gio"] : []) {
  const calls: { cmd: string; args: string[]; env: Record<string, string>; detached: boolean }[] = [];
  const launch: Launch = (cmd, args, opts) => {
    calls.push({ cmd, args, env: opts.env, detached: opts.detached });
    const child = Object.assign(new EventEmitter(), { unref: () => {} });
    queueMicrotask(() => (missing.includes(cmd) ? child.emit("error", new Error("ENOENT")) : child.emit("spawn")));
    return child;
  };
  return { launch, calls };
}

describe("links leave the app for the person's own browser", () => {
  test("the browser gets the session's environment without the app's desktop identity or its loader, Bun and Node switches (T1062)", () => {
    expect(browserEnv(KIWI_ENV)).toEqual({ PATH: "/usr/bin", HOME: "/home/a", DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", XDG_CURRENT_DESKTOP: "GNOME" });
  });

  test("on Linux a link goes to xdg-open, detached, with that environment", async () => {
    const { launch, calls } = fakeLaunch();
    const fallback: string[] = [];
    await openInBrowser(web("https://example.com/a"), async (u) => void fallback.push(u), "linux", KIWI_ENV, launch);
    expect(calls).toEqual([{ cmd: "xdg-open", args: ["https://example.com/a"], env: browserEnv(KIWI_ENV), detached: true }]);
    expect(fallback).toEqual([]);
  });

  test("on Linux without xdg-open, gio opens it, each with the link as one argument and no shell, never through Electrobun's opener (Livewire #236, T839)", async () => {
    const { launch, calls } = fakeLaunch(false, ["xdg-open"]);
    const fallback: string[] = [];
    const link = web("https://example.com/b/$(touch%20x)'`");
    await openInBrowser(link, async (u) => void fallback.push(u), "linux", KIWI_ENV, launch);
    expect(calls.map((c) => [c.cmd, ...c.args])).toEqual([
      ["xdg-open", link],
      ["gio", "open", "--", link],
    ]);
    expect(fallback).toEqual([]);
  });

  test("on Linux with neither xdg-open nor gio, the link fails to open rather than reach Electrobun's opener", async () => {
    const { launch } = fakeLaunch(true);
    const fallback: string[] = [];
    await expect(openInBrowser(web("https://example.com/c"), async (u) => void fallback.push(u), "linux", KIWI_ENV, launch)).rejects.toThrow("neither xdg-open nor gio");
    expect(fallback).toEqual([]);
  });

  test("on a Mac or Windows, the shell's own opener opens it", async () => {
    for (const platform of ["darwin", "win32"] as const) {
      const { launch, calls } = fakeLaunch();
      const fallback: string[] = [];
      await openInBrowser(web("https://example.com/c"), async (u) => void fallback.push(u), platform, KIWI_ENV, launch);
      expect(calls).toEqual([]);
      expect(fallback).toEqual(["https://example.com/c"]);
    }
  });
});
