import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bumpCask, bumpFormula, CASK, FORMULA, releaseVersion, sumsOf } from "../scripts/brew-bump.ts";

const TAP = resolve(import.meta.dir, "fixtures/homebrew-tap");
const A = "a".repeat(64);
const B = "b".repeat(64);
const SUMS = `${A}  Channels-2026.10.0-mac-arm64.dmg\n${B} *kiwi-darwin-arm64\n${"c".repeat(64)}  kiwi-linux-x64\n`;

const changed = (before: string, after: string) => {
  const a = before.split("\n");
  return after.split("\n").flatMap((line, i) => (line === a[i] ? [] : [line.trim()]));
};

describe("each release bumps the Homebrew tap's cask and formula from its SHA256SUMS", () => {
  test("on copies of both files, only the version or url and the sha256 change, each to the release's own", () => {
    const cask = readFileSync(join(TAP, CASK), "utf8");
    const formula = readFileSync(join(TAP, FORMULA), "utf8");
    const sums = sumsOf(SUMS);
    expect(changed(cask, bumpCask(cask, "2026.10.0", sums))).toEqual(['version "2026.10.0"', `sha256 "${A}"`]);
    expect(changed(formula, bumpFormula(formula, "v2026.10.0", sums))).toEqual(['url "https://github.com/kiwi-init/channels/releases/download/v2026.10.0/kiwi-darwin-arm64"', `sha256 "${B}"`]);
    expect(bumpCask(bumpCask(cask, "2026.10.0", sums), "2026.10.0", sums)).toBe(bumpCask(cask, "2026.10.0", sums));
  });

  test("the script edits a tap checkout in place", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-brew-"));
    try {
      cpSync(TAP, join(dir, "tap"), { recursive: true });
      writeFileSync(join(dir, "SHA256SUMS"), SUMS);
      const run = Bun.spawnSync(["bun", resolve(import.meta.dir, "../scripts/brew-bump.ts"), "v2026.10.0", join(dir, "SHA256SUMS"), join(dir, "tap")]);
      expect(run.exitCode).toBe(0);
      expect(readFileSync(join(dir, "tap", CASK), "utf8")).toContain('version "2026.10.0"');
      expect(readFileSync(join(dir, "tap", FORMULA), "utf8")).toContain("/download/v2026.10.0/kiwi-darwin-arm64");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("it refuses a pre-release, a file it can't download, and a file that isn't the shape it edits", () => {
    const cask = readFileSync(join(TAP, CASK), "utf8");
    const formula = readFileSync(join(TAP, FORMULA), "utf8");
    expect(releaseVersion("v2026.10.0")).toBe("2026.10.0");
    expect(() => releaseVersion("v2026.10.1-rc.1")).toThrow("pre-release");
    expect(() => bumpCask(cask, "2026.10.0", sumsOf(`${B}  kiwi-darwin-arm64`))).toThrow("SHA256SUMS has no Channels-2026.10.0-mac-arm64.dmg");
    expect(() => bumpFormula(formula, "v2026.10.0", sumsOf(`${A}  Channels-2026.10.0-mac-arm64.dmg`))).toThrow("SHA256SUMS has no kiwi-darwin-arm64");
    expect(() => bumpCask(cask.replace('version "0.27.7"', 'version "0.27.7"\n  version "0.27.7"'), "2026.10.0", sumsOf(SUMS))).toThrow("2 version lines");
    expect(() => bumpCask(cask.replaceAll("#{version}", "0.27.7"), "2026.10.0", sumsOf(SUMS))).toThrow("doesn't name #{version}");
  });

  test("release.yml bumps the tap after publishing a release, never a release candidate, with the bus app's token for that repo alone", () => {
    type Step = { uses?: string; with?: Record<string, string>; run?: string };
    const jobs = (Bun.YAML.parse(readFileSync(resolve(import.meta.dir, "../.github/workflows/release.yml"), "utf8")) as { jobs: Record<string, { needs?: string; if?: string; steps: Step[] }> }).jobs;
    const job = jobs["bump-tap"];
    expect(job?.needs).toBe("publish");
    expect(job?.if).toBe("${{ !contains(github.ref_name, '-') }}");
    const app = job?.steps.find((s) => s.uses?.startsWith("actions/create-github-app-token@"));
    expect(app?.with).toMatchObject({ repositories: "homebrew-tap", "permission-contents": "write" });
    expect(job?.steps.some((s) => s.run?.includes("bun ../scripts/brew-bump.ts"))).toBe(true);
  });
});
