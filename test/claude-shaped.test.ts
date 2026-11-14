import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Settings, withoutOurs } from "../src/hooks/install/claude.ts";
import type { Outcome } from "./claude-shaped-scenarios.ts";

const base = JSON.parse(readFileSync(join(import.meta.dir, "claude-shaped-base.json"), "utf8")) as { base: string; outcomes: Outcome[] };
const by = new Map(base.outcomes.map((o) => [o.scenario, o]));
const phase = (scenario: string, name: string) => by.get(scenario)?.phases.find((p) => p.phase === name);

describe("Claude-shaped hook installers share one module and keep each caller's behaviour (#2413)", () => {
  test("every phase of every scenario gives the same files, results and errors as base", () => {
    expect(base.base).toMatch(/^[0-9a-f]{40}$/);
    const home = mkdtempSync(join(tmpdir(), "kiwi-claude-shaped-home-"));
    const run = Bun.spawnSync([process.execPath, join(import.meta.dir, "claude-shaped-scenarios.ts")], { env: { PATH: process.env.PATH ?? "", HOME: home }, stdout: "pipe", stderr: "pipe" });
    rmSync(home, { recursive: true, force: true });
    expect(run.stderr.toString()).toBe("");
    const head = JSON.parse(run.stdout.toString()) as Outcome[];
    expect(head.map((o) => o.scenario)).toEqual(base.outcomes.map((o) => o.scenario));
    for (const [i, o] of head.entries()) expect(o).toEqual(base.outcomes[i] as Outcome);
  });

  test("claude.ts still exports withoutOurs and Settings", () => {
    const s: Settings = { hooks: { Stop: [{ hooks: [{ type: "command", command: "echo someone-else" }] }, { hooks: [] }] } };
    expect(withoutOurs(s.hooks?.Stop)).toEqual([{ hooks: [{ type: "command", command: "echo someone-else" }] }]);
  });

  test("the base covers each caller's distinct policy", () => {
    const listens = (scenario: string) => (phase(scenario, "install")?.files["claude/settings.json"] ?? "").includes("asyncRewake");
    expect(listens("claude default install, reinstall, uninstall; version unknown")).toBe(false);
    expect(listens("claude default install, reinstall, uninstall; Claude 2.1.200")).toBe(false);
    expect(listens("claude default install, reinstall, uninstall; Claude 2.1.300")).toBe(true);
    expect(listens("claude default install over stale listen and permission; version unknown")).toBe(true);
    expect(listens("claude default install over current listen; Claude 2.1.200")).toBe(false);
    expect(phase("claude uninstall with no settings file", "uninstall")?.files).toEqual({ "claude/settings.json": "{}\n" });
    expect(phase("codex install, reinstall, uninstall, uninstall again", "uninstall")?.files).toEqual({});
    expect(phase("grok uninstall of only ours removes the file", "uninstall")?.files).toEqual({});
    expect(phase("claude over a malformed group", "uninstall")?.result).toStartWith("threw TypeError");
    expect(phase("claude.ts withoutOurs", "malformed")?.result).toStartWith("threw TypeError");
    expect(phase("gemini over a JSON array", "install")?.result).toBe("threw Error: not a JSON object");
    expect(phase("claude install over a JSON array", "install")?.result).toStartWith("ok");
    expect(Object.keys(phase("zcode with hooks enabled unset", "install")?.files ?? {})).toContain("kiwi/config.json");
    expect(Object.keys(phase("zcode with hooks enabled", "install")?.files ?? {})).not.toContain("kiwi/config.json");
    expect(phase("zcode with hooks disabled", "install")?.result).toStartWith("threw Error: ZCode's hooks are off");
    const zcode = phase("zcode keeps malformed and empty foreign groups", "uninstall")?.files["zcode/config.json"] ?? "";
    expect(zcode).toContain('"text"');
    expect(zcode).toContain('"hooks": []');
    expect(zcode).not.toContain("hook stop # kiwi");
  });
});
