import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Step {
  name?: string;
  run?: string;
}
interface Job {
  needs?: string | string[];
  steps?: Step[];
}

const release = Bun.YAML.parse(await Bun.file(".github/workflows/release.yml").text()) as { jobs: Record<string, Job> };

function step(job: string, name: string): Step & { run: string } {
  const found = release.jobs[job]?.steps?.find((s) => s.name === name);
  if (!found?.run) throw new Error(`release.yml's ${job} job has no "${name}" step; update this test`);
  return { ...found, run: found.run };
}

const needs = (job: string): string[] => [release.jobs[job]?.needs ?? []].flat();

const root = mkdtempSync(join(tmpdir(), "kiwi-release-livewire-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const gitEnv = {
  PATH: process.env["PATH"] ?? "",
  HOME: root,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "kiwi",
  GIT_AUTHOR_EMAIL: "kiwi@example.com",
  GIT_COMMITTER_NAME: "kiwi",
  GIT_COMMITTER_EMAIL: "kiwi@example.com",
};

function repo(name: string): (...args: string[]) => string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]): string => {
    const r = Bun.spawnSync(["git", ...args], { cwd: dir, env: gitEnv });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
    return r.stdout.toString().trim();
  };
  git("init", "-q", "-b", "main");
  return git;
}

function bash(script: string, cwd: string, env: Record<string, string>): { code: number; out: string } {
  const r = Bun.spawnSync(["bash", "-e", "-c", script], { cwd, env: { ...gitEnv, ...env } });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

test("a tag releases only when it's vYYYY.M.PATCH-livewire.N on a commit of main (T839)", () => {
  const git = repo("tags");
  git("commit", "-q", "--allow-empty", "-m", "a");
  const older = git("rev-parse", "HEAD");
  git("commit", "-q", "--allow-empty", "-m", "b");
  const tip = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", tip);
  git("checkout", "-q", "-b", "side", older);
  git("commit", "-q", "--allow-empty", "-m", "c");
  const side = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/elsewhere", side);

  const check = step("on-livewire", "Check the tag is a Livewire release on main").run;
  const run = (sha: string, tag: string) => bash(check, join(root, "tags"), { GITHUB_SHA: sha, GITHUB_REF_NAME: tag });

  for (const sha of [tip, older]) expect({ sha, code: run(sha, "v2026.10.2-livewire.1").code }).toEqual({ sha, code: 0 });
  const offBranch = run(side, "v2026.10.2-livewire.1");
  expect(offBranch.code).toBe(1);
  expect(offBranch.out).toContain("isn't on main");
  for (const tag of ["v2026.10.2", "v2026.10.2-rc.1", "livewire-v2026.10.2-livewire.1", "v2026.10.2-livewire.1x", "v2026.10-livewire.1", "v2026.10.2-livewire.1;true"]) {
    const r = run(tip, tag);
    expect({ tag, code: r.code }).toEqual({ tag, code: 1 });
    expect(r.out).toContain("isn't vYYYY.M.PATCH-livewire.N");
  }
});

test("nothing in the release starts before the Livewire check passes", () => {
  expect(needs("on-livewire")).toEqual([]);
  expect(needs("build")).toContain("on-livewire");
  const reaches = (job: string, seen: Set<string> = new Set()): boolean => job === "on-livewire" || needs(job).some((n) => !seen.has(n) && (seen.add(n), reaches(n, seen)));
  for (const job of Object.keys(release.jobs)) expect({ job, gated: reaches(job) }).toEqual({ job, gated: true });
});

test("release.yml runs only for -livewire. tags and publishes a prerelease that never becomes the latest release", async () => {
  const on = (Bun.YAML.parse(await Bun.file(".github/workflows/release.yml").text()) as { on: { push: { tags: string[] } } }).on;
  expect(on.push.tags).toEqual(["v*-livewire.*"]);
  const publish = step("publish", "Publish").run;
  expect(publish).toContain("--prerelease --latest=false");
});
