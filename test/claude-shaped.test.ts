import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Outcome } from "./claude-shaped-scenarios.ts";

const base = JSON.parse(readFileSync(join(import.meta.dir, "claude-shaped-base.json"), "utf8")) as { base: string; outcomes: Outcome[] };

describe("Claude-shaped hook installers share one module and keep each caller's behaviour (#2413)", () => {
  test("every install, uninstall and check gives the same files, results and errors as base", () => {
    expect(base.base).toMatch(/^[0-9a-f]{40}$/);
    const run = Bun.spawnSync(["bun", join(import.meta.dir, "claude-shaped-scenarios.ts")], { stdout: "pipe", stderr: "pipe" });
    expect(run.stderr.toString()).toBe("");
    const head = JSON.parse(run.stdout.toString()) as Outcome[];
    expect(head.map((o) => o.scenario)).toEqual(base.outcomes.map((o) => o.scenario));
    for (const [i, o] of head.entries()) expect(o).toEqual(base.outcomes[i] as Outcome);
  });

  test("the base covers each caller's distinct policy", () => {
    const by = new Map(base.outcomes.map((o) => [o.scenario, o]));
    const claudeAbsent = by.get("claude uninstall with no settings file");
    expect(claudeAbsent?.files).toEqual({ "claude/settings.json": "{}\n" });
    expect(by.get("codex uninstall with no file")?.files).toEqual({});
    expect(by.get("grok uninstall of only ours removes the file")?.files).toEqual({});
    expect(by.get("claude uninstall over a malformed group")?.result).toStartWith("threw TypeError");
    expect(by.get("gemini install over a JSON array")?.result).toBe("threw Error: not a JSON object");
    expect(by.get("claude install over a JSON array")?.result).toStartWith("ok");
    const zcode = by.get("zcode install and uninstall keep malformed and empty foreign groups")?.files["zcode/config.json"] ?? "";
    expect(zcode).toContain('"text"');
    expect(zcode).toContain('"hooks": []');
    expect(zcode).not.toContain("hook stop # kiwi");
  });
});
