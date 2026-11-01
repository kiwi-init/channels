import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchAgent } from "../src/launch/launch.ts";
import { helpersOn, launchesOn, switchHelpers } from "../src/terminals/registry.ts";

const root = mkdtempSync(join(tmpdir(), "kiwi-terminal-config-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let homes = 0;
function kiwiHome(config?: object): string {
  const dir = join(root, `home-${homes++}`);
  mkdirSync(join(dir, "kiwi"), { recursive: true });
  if (config) writeFileSync(join(dir, "kiwi", "config.json"), JSON.stringify(config));
  return dir;
}

function kiwiWith(dir: string, over: Record<string, string>, ...argv: string[]): { code: number; stdout: string; stderr: string } {
  const env = {
    ...process.env,
    KIWI_HOME: join(dir, "kiwi"),
    HOME: dir,
    XDG_CONFIG_HOME: join(dir, "config"),
    KIWI_TMUX_CONF: join(dir, "tmux", "tmux.conf"),
    TMUX_TMPDIR: join(dir, "tmux"),
    ...over,
  };
  const p = Bun.spawnSync([process.execPath, join(import.meta.dir, "../src/cli/main.ts"), ...argv], { env });
  return { code: p.exitCode, stdout: p.stdout.toString().trim(), stderr: p.stderr.toString().trim() };
}

const kiwi = (dir: string, ...argv: string[]) => kiwiWith(dir, {}, ...argv);

function script(file: string, body: string): string {
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

const saved = (dir: string): Record<string, unknown> => JSON.parse(readFileSync(join(dir, "kiwi", "config.json"), "utf8")) as Record<string, unknown>;

describe("terminal helpers, and whether new agents may start", () => {
  test("a terminal's helpers are on only when its switch says so", () => {
    expect(helpersOn("rex", { terminals: { helpers: { rex: "on" } } })).toBe(true);
    expect(helpersOn("rex", { terminals: { helpers: { rex: "off" } } })).toBe(false);
    expect(helpersOn("rex", {})).toBe(false);
  });

  test("switching a terminal's helpers writes its switch and keeps the other's", () => {
    expect(switchHelpers({ helpers: { rex: "on" } }, "rex", false)).toEqual({ helpers: { rex: "off" } });
    expect(switchHelpers({}, "rex", true)).toEqual({ helpers: { rex: "on" } });
    expect(switchHelpers({ helpers: { rex: "on" } }, "tmux", true)).toEqual({ helpers: { rex: "on", tmux: "on" } });
  });

  test("creating new agents is on unless it was turned off, and off refuses every launch before anything runs", async () => {
    expect(launchesOn({})).toBe(true);
    expect(launchesOn({ launch: "off" })).toBe(false);
    const refused = await launchAgent(
      { harness: "claude", folder: "relative", code: "nope" },
      { config: { launch: "off" }, hosted: { ready: async () => null, open: async () => ({ ok: false, why: "failed", detail: "" }), pane: () => null } },
    );
    expect(refused).toEqual({ ok: false, why: "not-allowed", detail: "Creating new agents is off on this computer (kiwi launches on turns it back on)" });
  });
});

describe("kiwi terminal and kiwi launches", () => {
  test("a fresh computer has creating new agents on, says they open in Channels' own tmux, and has no terminal to prefer", () => {
    const dir = kiwiHome();
    const got = kiwi(dir, "terminal", "status", "--json");
    expect(got.code).toBe(0);
    expect(JSON.parse(got.stdout)).toMatchObject({ launch: "on" });
    expect(JSON.parse(got.stdout)).not.toHaveProperty("prefer");
    expect(kiwi(dir, "terminal", "status").stdout).toContain("New agents open in Channels' own tmux");
    expect(kiwi(dir, "terminal", "prefer", "rex").code).toBe(1);
  });

  test("kiwi terminal download tmux writes its helpers and turns its switch on, and remove takes both back", () => {
    const dir = kiwiHome();
    const conf = join(dir, "tmux", "tmux.conf");
    const tmux = (): { helpers: string | null } | undefined =>
      (JSON.parse(kiwi(dir, "terminal", "status", "--json").stdout) as { terminals: { id: string; helpers: string | null }[] }).terminals.find((t) => t.id === "tmux");
    expect(tmux()?.helpers).toBe("off");
    expect(kiwi(dir, "terminal", "download", "tmux").code).toBe(0);
    expect(tmux()?.helpers).toBe("on");
    expect(saved(dir)).toMatchObject({ terminals: { helpers: { tmux: "on" } } });
    expect(readFileSync(conf, "utf8")).toBe(`source-file -q "${join(dir, "tmux", "kiwi.tmux.conf")}" # Kiwi\n`);
    expect(readFileSync(join(dir, "tmux", "kiwi.tmux.conf"), "utf8")).toContain("terminal show --needs-you");
    expect(kiwi(dir, "terminal", "remove", "tmux").code).toBe(0);
    expect(tmux()?.helpers).toBe("off");
    expect(saved(dir)).toMatchObject({ terminals: { helpers: { tmux: "off" } } });
    expect([existsSync(conf), existsSync(join(dir, "tmux", "kiwi.tmux.conf"))]).toEqual([false, false]);
  });

  test("download and remove find tmux on the login shell's PATH, as from the app, and load and take back the helpers in a seat's running server", () => {
    const dir = kiwiHome();
    const bin = join(dir, "login-bin");
    mkdirSync(bin);
    const calls = join(dir, "tmux-calls");
    script(join(bin, "tmux"), `echo "$@" >> '${calls}'`);
    const shell = script(join(dir, "login-shell"), `echo __kiwi_login_path__\necho '${bin}:/usr/bin:/bin'`);
    const socket = join(dir, "server.sock");
    writeFileSync(socket, "");
    writeFileSync(join(dir, "kiwi", "config.json"), JSON.stringify({ channels: {}, bindings: { [join(dir, "work")]: { alias: "ch", as: "ana", tmux: { socket, pane: "%1" } } } }));
    const app = { SHELL: shell, PATH: "/usr/bin:/bin" };
    expect(kiwiWith(dir, app, "terminal", "download", "tmux").code).toBe(0);
    expect(readFileSync(calls, "utf8").split("\n")).toContain(`-u -S ${realpathSync(socket)} source-file -q ${join(dir, "tmux", "kiwi.tmux.conf")}`);
    expect(kiwiWith(dir, app, "terminal", "remove", "tmux").code).toBe(0);
    expect(readFileSync(calls, "utf8").split("\n")).toContain(`-u -S ${realpathSync(socket)} list-windows -a -F #{window_id}`);
  });

  test("kiwi terminal show --needs-you says in one line, and succeeds, when there's no seat to show", () => {
    const dir = kiwiHome({ channels: {}, terminals: { helpers: { tmux: "on" } } });
    expect(kiwi(dir, "terminal", "show", "--needs-you")).toEqual({ code: 0, stdout: "No seat here runs where Kiwi can show it (Rex or tmux, with its helpers on)", stderr: "" });
    expect(kiwi(dir, "terminal", "show").code).toBe(1);
  });

  test("kiwi launches turns creating new agents off and on, and says which", () => {
    const dir = kiwiHome();
    expect(kiwi(dir, "launches", "off").code).toBe(0);
    expect(saved(dir)).toMatchObject({ launch: "off" });
    expect(JSON.parse(kiwi(dir, "launches", "status", "--json").stdout)).toEqual({ launch: "off" });
    expect(kiwi(dir, "launches", "on").stdout).toStartWith("Creating new agents is on for this computer");
    expect(kiwi(dir, "launches", "maybe").code).toBe(1);
  });

  test("kiwi context-line is off on a fresh computer, and on and off write the one setting Settings reads, as JSON with --json", () => {
    const dir = kiwiHome();
    expect(JSON.parse(kiwi(dir, "context-line", "status", "--json").stdout)).toEqual({ contextLine: "off" });
    expect(kiwi(dir, "context-line", "status").stdout).toStartWith("the context line is off for this computer");
    expect(JSON.parse(kiwi(dir, "context-line", "on", "--json").stdout)).toEqual({ contextLine: "on" });
    expect(saved(dir)).toMatchObject({ contextLine: "on" });
    expect(JSON.parse(kiwi(dir, "context-line", "status", "--json").stdout)).toEqual({ contextLine: "on" });
    expect(kiwi(dir, "context-line", "off").stdout).toStartWith("the context line is off for this computer");
    expect(saved(dir)).toMatchObject({ contextLine: "off" });
    expect(kiwi(dir, "context-line", "maybe").code).toBe(1);
  });

  test("an old rex: on becomes the Rex helpers on, written in the new shape on the next save", () => {
    const dir = kiwiHome({ channels: {}, rex: "on" });
    expect(JSON.parse(kiwi(dir, "terminal", "status", "--json").stdout)).toMatchObject({ terminals: [{ id: "rex", helpers: "on" }, { id: "tmux" }] });
    expect(kiwi(dir, "launches", "on").code).toBe(0);
    const cfg = saved(dir);
    expect(cfg).toMatchObject({ terminals: { helpers: { rex: "on" } }, launch: "on" });
    expect(cfg).not.toHaveProperty("rex");
    const off = kiwiHome({ channels: {}, rex: "off" });
    expect(JSON.parse(kiwi(off, "terminal", "status", "--json").stdout)).toMatchObject({ terminals: [{ id: "rex", helpers: "off" }, { id: "tmux" }] });
  });

  test("kiwi rex status --json keeps the shape the desktop app reads, and its text names the new command", () => {
    const dir = kiwiHome({ channels: {}, rex: "on" });
    expect(Object.keys(JSON.parse(kiwi(dir, "rex", "status", "--json").stdout)).filter((k) => k !== "version")).toEqual(["found", "server", "helpers", "rotation"]);
    expect(JSON.parse(kiwi(dir, "rex", "status", "--json").stdout)).toMatchObject({ helpers: "on" });
    expect(kiwi(dir, "rex", "status").stdout).toContain("kiwi rex on|off|status is now kiwi terminal download|remove rex and kiwi terminal status");
  });
});
