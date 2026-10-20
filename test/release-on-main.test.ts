import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FILES } from "../scripts/stamp.ts";

interface Step {
  name?: string;
  run?: string;
  env?: Record<string, string>;
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

const root = mkdtempSync(join(tmpdir(), "kiwi-release-on-main-"));
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

test("a tag releases only when its commit is on main", () => {
  const git = repo("tags");
  git("commit", "-q", "--allow-empty", "-m", "a");
  const older = git("rev-parse", "HEAD");
  git("commit", "-q", "--allow-empty", "-m", "b");
  const tip = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", tip);
  git("checkout", "-q", "-b", "side", older);
  git("commit", "-q", "--allow-empty", "-m", "c");
  const side = git("rev-parse", "HEAD");
  git("tag", "-a", "v9.9.9", "-m", "on side", side);
  git("tag", "-a", "v9.9.8", "-m", "on main", tip);

  const check = step("on-main", "Check the tagged commit is on main").run;
  const run = (sha: string) => bash(check, join(root, "tags"), { GITHUB_SHA: sha, GITHUB_REF_NAME: "v9.9.9" });

  for (const sha of [tip, older, git("rev-parse", "v9.9.8")]) expect({ sha, code: run(sha).code }).toEqual({ sha, code: 0 });
  for (const sha of [side, git("rev-parse", "v9.9.9")]) {
    const r = run(sha);
    expect({ sha, code: r.code }).toEqual({ sha, code: 1 });
    expect(r.out).toContain("isn't on main");
  }
});

test("nothing in the release starts before the on-main check passes", () => {
  expect(needs("on-main")).toEqual([]);
  expect(needs("build")).toContain("on-main");
  const reaches = (job: string, seen: Set<string> = new Set()): boolean => job === "on-main" || needs(job).some((n) => !seen.has(n) && (seen.add(n), reaches(n, seen)));
  for (const job of Object.keys(release.jobs)) expect({ job, gated: reaches(job) }).toEqual({ job, gated: true });
});

test("bump-main's list of stamped files is scripts/stamp.ts's, plus CHANGELOG.md", () => {
  const listed = step("bump-main", "Check the stamp only edits the stamped files").env?.["STAMPED"]?.trim().split("\n");
  expect(listed).toEqual([...FILES, "CHANGELOG.md"]);
});

test("bump-main pushes a stamp that edits the stamped files, and refuses one that touches anything else", () => {
  const git = repo("stamps");
  const dir = join(root, "stamps");
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  };
  for (const file of [...FILES, "CHANGELOG.md", ".github/workflows/ci.yml", "version.ts"]) write(file, `${file} 1.0.0\n`);
  git("add", "-A");
  git("commit", "-q", "-m", "base");

  const check = step("bump-main", "Check the stamp only edits the stamped files");
  const temp = join(root, "runner");
  mkdirSync(join(temp, "stamp"), { recursive: true });
  const patchOf = (change: () => void) => {
    change();
    git("add", "-A");
    const patch = git("diff", "--cached", "HEAD");
    git("reset", "-q", "--hard", "HEAD");
    git("clean", "-q", "-fd");
    writeFileSync(join(temp, "stamp", "stamp.patch"), patch ? `${patch}\n` : "");
    return bash(check.run, dir, { RUNNER_TEMP: temp, STAMPED: check.env?.["STAMPED"] ?? "" });
  };
  const stamp = () => {
    for (const file of [...FILES, "CHANGELOG.md"]) write(file, `${file} 1.0.1\n`);
  };

  expect(patchOf(() => undefined).code).toBe(0);
  expect(patchOf(stamp).code).toBe(0);

  const refused: [string, () => void, string][] = [
    ["edits a workflow", () => (stamp(), write(".github/workflows/ci.yml", "evil\n")), ".github/workflows/ci.yml"],
    ["edits a file whose path is part of a stamped one", () => write("version.ts", "evil\n"), "version.ts"],
    ["adds a file", () => write("src/new.ts", "evil\n"), "create mode"],
    ["deletes a file", () => rmSync(join(dir, "site/README.md")), "delete mode"],
    ["renames a file", () => git("mv", "site/app.js", "site/app2.js"), "rename"],
    ["makes a stamped file executable", () => chmodSync(join(dir, "package.json"), 0o755), "mode change"],
  ];
  for (const [what, change, says] of refused) {
    const r = patchOf(change);
    expect({ what, code: r.code }).toEqual({ what, code: 1 });
    expect(r.out).toContain(says);
  }
});
