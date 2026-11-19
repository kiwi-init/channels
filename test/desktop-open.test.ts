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

type Acts = "missing" | "running" | { exit: number; stderr?: string };

function fakeLaunch(fail = false, missing: readonly string[] = fail ? ["xdg-open", "gio"] : [], acts: Record<string, Acts> = {}) {
  const calls: { cmd: string; args: string[]; env: Record<string, string>; detached: boolean }[] = [];
  const destroyed: string[] = [];
  const launch: Launch = (cmd, args, opts) => {
    calls.push({ cmd, args, env: opts.env, detached: opts.detached });
    const stderr = Object.assign(new EventEmitter(), { destroy: () => void destroyed.push(cmd) });
    const child = Object.assign(new EventEmitter(), { unref: () => {}, stderr });
    const act: Acts = missing.includes(cmd) ? "missing" : (acts[cmd] ?? { exit: 0 });
    queueMicrotask(() => {
      if (act === "missing") return void child.emit("error", new Error("ENOENT"));
      child.emit("spawn");
      if (act === "running") return;
      child.emit("exit", act.exit, null);
      if (act.stderr) stderr.emit("data", Buffer.from(act.stderr));
      stderr.emit("close");
    });
    return child;
  };
  return { launch, calls, destroyed };
}

const NOV_17 = [
  "Selected DE kde",
  "/usr/bin/xdg-open: line 757: kfmclient: command not found",
  "/usr/bin/xdg-open: line 554: test: : integer expected",
  "/usr/bin/xdg-open: line 555: test: : integer expected",
  "/usr/bin/xdg-open: line 556: test: : integer expected",
  "",
].join("\n");
const GENERIC_THEN_OPENED = ["Selected DE generic", "/usr/bin/xdg-open: line 1045: kfmclient: command not found", ""].join("\n");
const NO_METHOD = ["Selected DE generic", "/usr/bin/xdg-open: line 1045: w3m: command not found", "xdg-open: no method available for opening 'https://example.com/d'", ""].join("\n");

describe("links leave the app for the person's own browser", () => {
  test("the browser gets the session's environment without the app's desktop identity or its loader, Bun and Node switches (T1062)", () => {
    expect(browserEnv(KIWI_ENV)).toEqual({ PATH: "/usr/bin", HOME: "/home/a", DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", XDG_CURRENT_DESKTOP: "GNOME" });
  });

  test("on Linux a link goes to xdg-open, detached, with that environment", async () => {
    const { launch, calls } = fakeLaunch();
    const fallback: string[] = [];
    await openInBrowser(web("https://example.com/a"), async (u) => void fallback.push(u), "linux", KIWI_ENV, launch);
    expect(calls).toEqual([{ cmd: "xdg-open", args: ["https://example.com/a"], env: { ...browserEnv(KIWI_ENV), XDG_UTILS_DEBUG_LEVEL: "2" }, detached: true }]);
    expect(fallback).toEqual([]);
  });

  test("on Linux without xdg-open, gio opens it, each with the link as one argument and no shell, never through Electrobun's opener (Livewire #236, T990)", async () => {
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

  test("on Linux an xdg-open that exits non-zero rejects with its exit code and last stderr line, and gio isn't tried (#2534)", async () => {
    const { launch, calls } = fakeLaunch(false, [], { "xdg-open": { exit: 3, stderr: NO_METHOD } });
    await expect(openInBrowser(web("https://example.com/d"), async () => {}, "linux", KIWI_ENV, launch)).rejects.toThrow(
      "xdg-open couldn't open the link: exit 3: xdg-open: no method available for opening 'https://example.com/d'",
    );
    expect(calls.map((c) => c.cmd)).toEqual(["xdg-open"]);
  });

  test("on Linux the Nov 17 case, KDE's branch with no kfmclient and exit 0, rejects; a generic run that skips a missing kfmclient and opens still counts as opened (#2534)", async () => {
    const nov17 = fakeLaunch(false, [], { "xdg-open": { exit: 0, stderr: NOV_17 } });
    await expect(openInBrowser(web("https://example.com/e"), async () => {}, "linux", KIWI_ENV, nov17.launch)).rejects.toThrow(
      "xdg-open couldn't open the link: exit 0, but kfmclient, its only way to open a link in this KDE session, isn't installed: /usr/bin/xdg-open: line 757: kfmclient: command not found",
    );
    const generic = fakeLaunch(false, [], { "xdg-open": { exit: 0, stderr: GENERIC_THEN_OPENED } });
    await openInBrowser(web("https://example.com/e"), async () => {}, "linux", KIWI_ENV, generic.launch);
    expect(generic.calls.map((c) => c.cmd)).toEqual(["xdg-open"]);
  });

  test("on Linux an opener that keeps running counts as opened within the bound, and a clean exit shows nothing (#2534)", async () => {
    const { launch, destroyed } = fakeLaunch(false, [], { "xdg-open": "running" });
    const started = performance.now();
    await openInBrowser(web("https://example.com/f"), async () => {}, "linux", KIWI_ENV, launch, 50);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(destroyed).toEqual(["xdg-open"]);
    await expect(openInBrowser(web("https://example.com/g"), async () => {}, "linux", KIWI_ENV, fakeLaunch().launch)).resolves.toBeUndefined();
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
