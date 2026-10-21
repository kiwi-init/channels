import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchAgent } from "../src/launch/launch.ts";
import { helpersOn, launchesOn, preferred, switchHelpers } from "../src/terminals/registry.ts";

const root = mkdtempSync(join(tmpdir(), "kiwi-terminal-config-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let homes = 0;
function kiwiHome(config?: object): string {
  const dir = join(root, `home-${homes++}`);
  mkdirSync(join(dir, "kiwi"), { recursive: true });
  if (config) writeFileSync(join(dir, "kiwi", "config.json"), JSON.stringify(config));
  return dir;
}

function kiwi(dir: string, ...argv: string[]): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, KIWI_HOME: join(dir, "kiwi"), HOME: dir, XDG_CONFIG_HOME: join(dir, "config") };
  const p = Bun.spawnSync([process.execPath, join(import.meta.dir, "../src/cli/main.ts"), ...argv], { env });
  return { code: p.exitCode, stdout: p.stdout.toString().trim(), stderr: p.stderr.toString().trim() };
}

const saved = (dir: string): Record<string, unknown> => JSON.parse(readFileSync(join(dir, "kiwi", "config.json"), "utf8")) as Record<string, unknown>;

describe("where new agents open, and whether they may", () => {
  test("a terminal's helpers are on only when its switch says so, and the app has none", () => {
    expect(helpersOn("rex", { terminals: { helpers: { rex: "on" } } })).toBe(true);
    expect(helpersOn("rex", { terminals: { helpers: { rex: "off" } } })).toBe(false);
    expect(helpersOn("tmux", {})).toBe(false);
    expect(helpersOn("app", { terminals: { helpers: {} } })).toBe(false);
  });

  test("Prefer holds only while that terminal's helpers are on; else Terminal", () => {
    expect(preferred({})).toBe("app");
    expect(preferred({ terminals: { prefer: "rex", helpers: { rex: "on" } } })).toBe("rex");
    expect(preferred({ terminals: { prefer: "rex", helpers: { rex: "off" } } })).toBe("app");
    expect(preferred({ terminals: { prefer: "tmux" } })).toBe("app");
  });

  test("removing the preferred terminal's helpers sets Prefer back to Terminal; downloading or removing another keeps it", () => {
    expect(switchHelpers({ prefer: "rex", helpers: { rex: "on" } }, "rex", false)).toEqual({ helpers: { rex: "off" } });
    expect(switchHelpers({ prefer: "rex", helpers: { rex: "on" } }, "tmux", false)).toEqual({ prefer: "rex", helpers: { rex: "on", tmux: "off" } });
    expect(switchHelpers({ prefer: "app" }, "rex", true)).toEqual({ prefer: "app", helpers: { rex: "on" } });
  });

  test("creating new agents is on unless it was turned off, and off refuses every launch before anything runs", async () => {
    expect(launchesOn({})).toBe(true);
    expect(launchesOn({ launch: "off" })).toBe(false);
    const refused = await launchAgent({ harness: "claude", folder: "relative", code: "nope" }, { config: { launch: "off" } });
    expect(refused).toEqual({ ok: false, why: "not-allowed", detail: "Creating new agents is off on this computer (kiwi launches on turns it back on)" });
  });
});

describe("kiwi terminal and kiwi launches", () => {
  test("a fresh computer opens new agents in Terminal, with creating them on", () => {
    const dir = kiwiHome();
    const got = kiwi(dir, "terminal", "status", "--json");
    expect(got.code).toBe(0);
    expect(JSON.parse(got.stdout)).toMatchObject({ prefer: "app", launch: "on" });
  });

  test("Prefer refuses a terminal whose helpers aren't downloaded, and tmux has none to download yet", () => {
    const dir = kiwiHome();
    expect(kiwi(dir, "terminal", "prefer", "rex")).toMatchObject({ code: 1, stderr: "kiwi: Download the Rex helpers first: kiwi terminal download rex" });
    expect(kiwi(dir, "terminal", "download", "tmux")).toMatchObject({ code: 1, stderr: "kiwi: tmux has no helpers to download yet" });
    expect(kiwi(dir, "terminal", "prefer", "app").code).toBe(0);
    expect(saved(dir)).toMatchObject({ terminals: { prefer: "app" } });
    expect(kiwi(dir, "terminal", "prefer", "moon").code).toBe(1);
  });

  test("kiwi launches turns creating new agents off and on, and says which", () => {
    const dir = kiwiHome();
    expect(kiwi(dir, "launches", "off").code).toBe(0);
    expect(saved(dir)).toMatchObject({ launch: "off" });
    expect(JSON.parse(kiwi(dir, "launches", "status", "--json").stdout)).toEqual({ launch: "off" });
    expect(kiwi(dir, "launches", "on").stdout).toStartWith("Creating new agents is on for this computer");
    expect(kiwi(dir, "launches", "maybe").code).toBe(1);
  });

  test("an old rex: on becomes the Rex helpers on and Rex preferred, written in the new shape on the next save", () => {
    const dir = kiwiHome({ channels: {}, rex: "on" });
    expect(JSON.parse(kiwi(dir, "terminal", "status", "--json").stdout)).toMatchObject({ prefer: "rex" });
    expect(kiwi(dir, "launches", "on").code).toBe(0);
    const cfg = saved(dir);
    expect(cfg).toMatchObject({ terminals: { prefer: "rex", helpers: { rex: "on" } }, launch: "on" });
    expect(cfg).not.toHaveProperty("rex");
    const off = kiwiHome({ channels: {}, rex: "off" });
    expect(JSON.parse(kiwi(off, "terminal", "status", "--json").stdout)).toMatchObject({ prefer: "app" });
  });

  test("kiwi rex status --json keeps the shape the desktop app reads, and its text names the new command", () => {
    const dir = kiwiHome({ channels: {}, rex: "on" });
    expect(Object.keys(JSON.parse(kiwi(dir, "rex", "status", "--json").stdout)).filter((k) => k !== "version")).toEqual(["found", "server", "helpers", "rotation"]);
    expect(JSON.parse(kiwi(dir, "rex", "status", "--json").stdout)).toMatchObject({ helpers: "on" });
    expect(kiwi(dir, "rex", "status").stdout).toContain("kiwi rex on|off|status is now kiwi terminal download|remove rex and kiwi terminal status");
  });
});
