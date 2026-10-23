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
};

function fakeLaunch(fail = false) {
  const calls: { cmd: string; args: string[]; env: Record<string, string>; detached: boolean }[] = [];
  const launch: Launch = (cmd, args, opts) => {
    calls.push({ cmd, args, env: opts.env, detached: opts.detached });
    const child = Object.assign(new EventEmitter(), { unref: () => {} });
    queueMicrotask(() => (fail ? child.emit("error", new Error("ENOENT")) : child.emit("spawn")));
    return child;
  };
  return { launch, calls };
}

describe("links leave the app for the person's own browser", () => {
  test("the browser gets the session's environment without the app's desktop identity", () => {
    expect(browserEnv(KIWI_ENV)).toEqual({ PATH: "/usr/bin", HOME: "/home/a", DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", XDG_CURRENT_DESKTOP: "GNOME" });
  });

  test("on Linux a link goes to xdg-open, detached, with that environment", async () => {
    const { launch, calls } = fakeLaunch();
    const fallback: string[] = [];
    await openInBrowser(web("https://example.com/a"), async (u) => void fallback.push(u), "linux", KIWI_ENV, launch);
    expect(calls).toEqual([{ cmd: "xdg-open", args: ["https://example.com/a"], env: browserEnv(KIWI_ENV), detached: true }]);
    expect(fallback).toEqual([]);
  });

  test("on Linux without xdg-open, Electron's own opener still opens it", async () => {
    const { launch } = fakeLaunch(true);
    const fallback: string[] = [];
    await openInBrowser(web("https://example.com/b"), async (u) => void fallback.push(u), "linux", KIWI_ENV, launch);
    expect(fallback).toEqual(["https://example.com/b"]);
  });

  test("on a Mac or Windows, Electron's own opener opens it", async () => {
    for (const platform of ["darwin", "win32"] as const) {
      const { launch, calls } = fakeLaunch();
      const fallback: string[] = [];
      await openInBrowser(web("https://example.com/c"), async (u) => void fallback.push(u), platform, KIWI_ENV, launch);
      expect(calls).toEqual([]);
      expect(fallback).toEqual(["https://example.com/c"]);
    }
  });
});
