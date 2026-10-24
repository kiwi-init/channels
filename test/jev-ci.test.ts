import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FLOWS } from "../scripts/ci-flows.ts";
import { loadConfig, matches, type Config } from "../.github/jev-ci/config.ts";
import { markMoves, size, type FileChange } from "../.github/jev-ci/diff.ts";
import { mergeGroupRange, passMarkers, testedByQueue, trustedRef, type PassCache, type PullEvent, type QueueRun } from "../.github/jev-ci/github.ts";
import type { Request } from "../.github/jev-ci/jev.ts";
import { plan, pullRequestOnly, skipAll, type Ask, type Decision, type Plan } from "../.github/jev-ci/plan.ts";

const ROOT = join(import.meta.dir, "..");
const CI = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
const CONFIG_TEXT = readFileSync(join(ROOT, ".github/jev-ci.yml"), "utf8");
const config: Config = await loadConfig(join(ROOT, ".github/jev-ci.yml"));
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function sh(dir: string, args: string[]): string {
  const p = Bun.spawnSync(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" });
  if (!p.success) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`);
  return p.stdout.toString().trim();
}

function write(dir: string, files: Record<string, string | null>) {
  for (const [path, text] of Object.entries(files)) {
    const full = join(dir, path);
    if (text === null) rmSync(full, { force: true });
    else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text);
    }
  }
}

function commit(dir: string, files: Record<string, string | null>): string {
  write(dir, files);
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "-q", "--allow-empty", "-m", "change"]);
  return sh(dir, ["rev-parse", "HEAD"]);
}

const big = Array.from({ length: 400 }, (_, i) => `export function step${i}(input: number): number { return input * ${i} + ${i * 7} }`).join("\n") + "\n";

const SEED: Record<string, string> = {
  ".github/workflows/ci.yml": CI,
  ".github/jev-ci.yml": CONFIG_TEXT,
  ".github/workflows/release-build.yml": "name: release-build\non: workflow_call\njobs:\n  version:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo version\n",
  ".github/actions/setup/action.yml": "name: setup\nruns:\n  using: composite\n  steps:\n    - shell: bash\n      run: bun install\n",
  ".github/actions/jev-ci-pass/action.yml": "name: pass\nruns:\n  using: composite\n  steps:\n    - shell: bash\n      run: echo pass\n",
  ".github/jev-ci/plan.ts": "export const planner = 1\n",
  "package.json": '{\n  "name": "fixture",\n  "version": "1.0.0"\n}\n',
  "src/version.ts": 'export const VERSION = "1.0.0"\n',
  "src/a.ts": "export const a = 1\n",
  "src/big.ts": big,
  "test/e2e.test.ts": 'import { w } from "../web/src/lib/w.ts"\nimport { a } from "../src/a.ts"\nimport { k } from "@fixture/kit/k.ts"\nexport const used = [w, a, k]\n',
  "packages/kit/package.json": '{\n  "name": "@fixture/kit",\n  "exports": { "./*": "./src/*" }\n}\n',
  "packages/kit/src/k.ts": 'import { deeper } from "./deeper.ts"\nexport const k = deeper\n',
  "packages/kit/src/deeper.ts": "export const deeper = 6\n",
  "packages/kit/src/unused.ts": "export const unused = 7\n",
  "test/join-seats.test.ts": 'import { a } from "../src/a.ts"\nexport const used = a\n',
  "test/unit-only.test.ts": "export const unit = 1\n",
  "web/src/lib/w.ts": 'import { deep } from "./deep"\nexport const w = deep\n',
  "web/src/lib/deep.ts": "export const deep = 2\n",
  "web/src/lib/v.ts": "export const v = 3\n",
  "docs/notes.md": "# notes\n",
};

function repo(): { dir: string; base: string } {
  const dir = mkdtempSync(join(tmpdir(), "jev-ci-test-"));
  dirs.push(dir);
  sh(dir, ["init", "-q", "-b", "main"]);
  sh(dir, ["config", "user.email", "ci@example.com"]);
  sh(dir, ["config", "user.name", "ci"]);
  sh(dir, ["config", "commit.gpgsign", "false"]);
  return { dir, base: commit(dir, SEED) };
}

function fakeJev(p: number | ((job: string, req: Request) => number) = 0.05): { ask: Ask; calls: Request[] } {
  const calls: Request[] = [];
  const ask: Ask = async (req) => {
    calls.push(req);
    const answers = Object.fromEntries(Object.keys(req.questions).map((job) => [job, { type: "noul" as const, noul: typeof p === "number" ? p : p(job, req) }]));
    return { model: req.model, answers, usage: { input_tokens: 10, output_tokens: 1 }, cached: false };
  };
  return { ask, calls };
}

async function planFor(files: Record<string, string | null>, jev = fakeJev()): Promise<{ result: Plan; calls: Request[]; by: (job: string) => Decision }> {
  const { dir, base } = repo();
  const head = commit(dir, files);
  const result = await plan({ repo: dir, base, head, config, ask: jev.ask });
  const by = (job: string) => {
    const d = result.decisions.find((x) => x.job === job);
    if (!d) throw new Error(`no decision for ${job}`);
    return d;
  };
  return { result, calls: jev.calls, by };
}

const ran = (r: Plan) =>
  r.decisions
    .filter((d) => d.run)
    .map((d) => d.job)
    .sort();
const CHECKS = ["static", "test-unit", "test-flows-a", "test-flows-b", "build", "shots", "perf-runs", "perf", "desktop", "desktop-mac", "desktop-linux", "cli-macos", "ios", "ios-gestures"];

describe("the iPhone jobs wait only on what the iPhone app is built from (T1598)", () => {
  const desktopOnly = {
    "desktop/package.json": '{\n  "name": "desktop",\n  "devDependencies": { "electrobun": "2.0.4" }\n}\n',
    "bun.lock": '{\n  "lockfileVersion": 1,\n  "packages": { "electrobun": ["electrobun@2.0.4"] }\n}\n',
  };

  test("a desktop-only dependency change doesn't queue them by rule: Jev judges it", async () => {
    const { by } = await planFor(desktopOnly);
    for (const job of ["ios", "ios-gestures"]) {
      expect(by(job).run).toBe(false);
      expect(by(job).layer).not.toBe("L0");
    }
  });

  test("Jev can still run them on a manifest change it thinks reaches the bundle", async () => {
    const { by } = await planFor(
      desktopOnly,
      fakeJev((job) => (job.startsWith("ios") ? 0.9 : 0.05)),
    );
    for (const job of ["ios", "ios-gestures"]) expect(by(job)).toMatchObject({ run: true, layer: "L2" });
  });

  test("@kiwi/core's manifest, the exports map the engine resolves through, runs them by rule", async () => {
    const { by } = await planFor({ "packages/core/package.json": '{\n  "name": "@kiwi/core",\n  "exports": { "./*": "./src/*" }\n}\n' });
    for (const job of ["ios", "ios-gestures"]) expect(by(job)).toMatchObject({ run: true, layer: "L0" });
  });
});

describe("ci.yml edits outside the jobs", () => {
  test("a concurrency-only edit (#315) runs only the static checks, by rule", async () => {
    const edited = CI.replace(/concurrency:\n(?: .*\n)+/, "concurrency:\n  group: ci-${{ github.ref }}\n  cancel-in-progress: true\n");
    expect(edited).not.toBe(CI);
    const { result, by } = await planFor({ ".github/workflows/ci.yml": edited });
    expect(ran(result)).toEqual(["static"]);
    expect(by("static").layer).toBe("L0");
    for (const job of ["test-flows-a", "test-flows-b", "build", "desktop", "cli-macos", "release-rehearsal"]) expect(by(job)).toMatchObject({ run: false, layer: "L0" });
    expect(by("test-unit").layer).toBe("L2");
    expect(result.notes.join(" ")).toContain("concurrency");
  });

  test("a comment or blank-line edit changes no job", async () => {
    const { result, by } = await planFor({ ".github/workflows/ci.yml": CI.replace("jobs:\n", "\n# a note\njobs:\n") });
    expect(ran(result)).toEqual(["static"]);
    expect(by("release-rehearsal").run).toBe(false);
    expect(result.notes).toEqual([]);
  });

  test("an `on:` edit runs nothing beyond the static checks", async () => {
    const { result } = await planFor({ ".github/workflows/ci.yml": CI.replace("  workflow_dispatch:\n", "  workflow_dispatch:\n  merge_group:\n") });
    expect(ran(result)).toEqual(["static"]);
  });

  test("a workflow-wide env runs every job", async () => {
    const { result } = await planFor({ ".github/workflows/ci.yml": CI.replace("permissions:\n", "env:\n  FOO: bar\n\npermissions:\n") });
    expect(ran(result)).toEqual([...CHECKS, "release-rehearsal"].sort());
  });

  test("workflow permissions run the jobs that inherit them, and a job whose part inherits them", async () => {
    const { result, by } = await planFor({ ".github/workflows/ci.yml": CI.replace("permissions:\n  contents: read\n", "permissions:\n  contents: read\n  issues: read\n") });
    expect(by("cli-macos")).toMatchObject({ run: true, layer: "L0" });
    expect(by("perf").reason).toContain("perf-runs");
    expect(ran(result)).toEqual([...CHECKS, "release-rehearsal"].sort());
  });
});

describe("ci.yml edits inside jobs", () => {
  test("a step edited in one job runs that job", async () => {
    const { result, by } = await planFor({ ".github/workflows/ci.yml": CI.replace("scripts/ci-tests.ts all --shard=", "scripts/ci-tests.ts all --bail --shard=") });
    expect(by("cli-macos")).toMatchObject({ run: true, layer: "L0" });
    expect(by("cli-macos").reason).toContain("its job in");
    expect(ran(result)).toEqual(["cli-macos", "static"]);
  });

  test("a change to a local action runs the jobs that use it, not the release rehearsal", async () => {
    const { result, by } = await planFor({ ".github/actions/setup/action.yml": "name: setup\nruns:\n  using: composite\n  steps:\n    - shell: bash\n      run: bun install --frozen-lockfile\n" });
    expect(by("build").reason).toContain("local action");
    expect(by("release-rehearsal").run).toBe(false);
    expect(ran(result)).toEqual(CHECKS.slice().sort());
  });

  test("a change to the reusable release workflow runs the rehearsal", async () => {
    const { result } = await planFor({
      ".github/workflows/release-build.yml": "name: release-build\non: workflow_call\njobs:\n  version:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo other\n",
    });
    expect(ran(result)).toEqual(["release-rehearsal", "static"]);
  });

  test("a workflow job with no entry in jev-ci.yml always runs", async () => {
    const extra = CI.replace("  ci-ok:\n", "  extra:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n\n  ci-ok:\n");
    const { by } = await planFor({ ".github/workflows/ci.yml": extra });
    expect(by("extra")).toMatchObject({ run: true, layer: "L0" });
  });

  test("a job's parts run and skip with it", async () => {
    const skipped = await planFor({ "docs/notes.md": "# notes, edited\n" });
    expect(skipped.by("perf-runs")).toMatchObject({ run: false, layer: "L0" });
    const forced = await planFor({ "scripts/perf-budgets.json": "{}\n" });
    expect(forced.by("perf")).toMatchObject({ run: true, layer: "L0" });
    expect(forced.by("perf-runs")).toMatchObject({ run: true, layer: "L0" });
    expect(forced.by("perf-runs").reason).toContain("perf / scale");
  });

  test("a change to a part's job runs the job it does part of", async () => {
    const { result, by } = await planFor({ ".github/workflows/ci.yml": CI.replace("        run: [1, 2, 3]\n", "        run: [1, 2, 3, 4]\n") });
    expect(by("perf")).toMatchObject({ run: true, layer: "L0" });
    expect(by("perf").reason).toContain("perf-runs");
    expect(ran(result)).toEqual(["perf", "perf-runs", "static"]);
  });

  test("a change to the gate job runs nothing else by itself", async () => {
    const { result } = await planFor({
      ".github/workflows/ci.yml": CI.replace(
        "    timeout-minutes: 5\n    permissions:\n      contents: read\n      pull-requests: write\n    steps:",
        "    timeout-minutes: 6\n    permissions:\n      contents: read\n      pull-requests: write\n    steps:",
      ),
    });
    expect(ran(result)).toEqual(["static"]);
    expect(result.notes.join(" ")).toContain("ci-ok");
  });
});

describe("jev-ci.yml edits", () => {
  test("a description-only edit runs nothing by rule", async () => {
    const { result } = await planFor({ ".github/jev-ci.yml": CONFIG_TEXT.replace("Builds the web dashboard for production", "Builds the web dashboard for production use") });
    expect(result.decisions.filter((d) => d.run && d.layer === "L0")).toEqual([]);
    expect(result.notes.join(" ")).toContain("wording");
  });

  test("a job's inputs edited run that job", async () => {
    const { by } = await planFor({
      ".github/jev-ci.yml": CONFIG_TEXT.replace('      - "test/check.ts"\n', '      - "test/check.ts"\n      - "test/other.ts"\n'),
    });
    expect(by("build")).toMatchObject({ run: true, layer: "L0" });
    expect(by("build").reason).toContain("inputs");
    expect(by("desktop").run).toBe(false);
  });

  test("a planner setting edited runs every job", async () => {
    const { result } = await planFor({ ".github/jev-ci.yml": CONFIG_TEXT.replace("threshold: 0.3", "threshold: 0.4") });
    expect(ran(result)).toEqual([...CHECKS, "release-rehearsal"].sort());
  });

  test("a planner code change runs every job", async () => {
    const { result } = await planFor({ ".github/jev-ci/plan.ts": "export const planner = 2\n" });
    expect(ran(result)).toEqual([...CHECKS, "release-rehearsal"].sort());
  });

  test("a planner README change doesn't run every job", async () => {
    const { result } = await planFor({ ".github/jev-ci/README.md": "# jev-ci\n" });
    expect(result.decisions.filter((d) => d.run && d.layer === "L0")).toEqual([]);
  });
});

describe("what each job reads", () => {
  test("a docs-only change runs nothing", async () => {
    const { result, calls } = await planFor({ "docs/notes.md": "# notes\n\nmore\n" });
    expect(ran(result)).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("a web file no flows test imports skips both flows jobs by rule", async () => {
    const { by } = await planFor({ "web/src/lib/v.ts": "export const v = 4\n" });
    expect(by("test-flows-a")).toMatchObject({ run: false, layer: "L0" });
    expect(by("test-flows-b")).toMatchObject({ run: false, layer: "L0" });
    expect(by("cli-macos")).toMatchObject({ run: false, layer: "L0" });
    expect(by("static")).toMatchObject({ run: true, layer: "L0" });
  });

  test("a web file a flows-a test imports, even indirectly, reaches flows-a only", async () => {
    const { by } = await planFor({ "web/src/lib/deep.ts": "export const deep = 5\n" });
    expect(by("test-flows-a").layer).toBe("L2");
    expect(by("test-flows-b")).toMatchObject({ run: false, layer: "L0" });
  });

  test("a workspace package module a flows-a test imports by package name reaches flows-a only", async () => {
    const { by } = await planFor({ "packages/kit/src/deeper.ts": "export const deeper = 8\n" });
    expect(by("test-flows-a").layer).toBe("L2");
    expect(by("test-flows-b")).toMatchObject({ run: false, layer: "L0" });
  });

  test("a workspace package module no flows test imports skips both flows jobs by rule", async () => {
    const { by } = await planFor({ "packages/kit/src/unused.ts": "export const unused = 9\n" });
    expect(by("test-flows-a")).toMatchObject({ run: false, layer: "L0" });
    expect(by("test-flows-b")).toMatchObject({ run: false, layer: "L0" });
  });

  test("a unit test edit doesn't reach the flows jobs", async () => {
    const { by } = await planFor({ "test/unit-only.test.ts": "export const unit = 2\n" });
    expect(by("test-flows-a")).toMatchObject({ run: false, layer: "L0" });
    expect(by("test-flows-b")).toMatchObject({ run: false, layer: "L0" });
    expect(by("test-unit").layer).toBe("L2");
  });

  test("a version bump runs only the release rehearsal", async () => {
    const { result } = await planFor({ "src/version.ts": 'export const VERSION = "1.0.1"\n', "package.json": '{\n  "name": "fixture",\n  "version": "1.0.1"\n}\n' });
    expect(ran(result)).toEqual(["release-rehearsal"]);
  });

  test("cli / macos runs by rule when the cross-compile build changes", async () => {
    const { by } = await planFor({ "scripts/build-cli.ts": "export const build = 1\n" });
    expect(by("cli-macos")).toMatchObject({ run: true, layer: "L0" });
  });
});

describe("Jev", () => {
  test("cli / macos is asked whether the change fails only on macOS", async () => {
    const { calls, by } = await planFor(
      { "src/a.ts": "export const a = 2\n" },
      fakeJev((job) => (job === "cli-macos" ? 0.1 : 0.9)),
    );
    const q = JSON.stringify(calls.map((c) => c.questions["cli-macos"]));
    expect(q).toContain("macOS");
    expect(q).toContain("Linux jobs too");
    expect(by("cli-macos")).toMatchObject({ run: false, layer: "L2" });
    expect(by("test-unit")).toMatchObject({ run: true, layer: "L2" });
    expect(by("test-unit").reason).toContain("src/a.ts 90%");
  });

  test("code moved between files is judged, not too big, and shown to Jev as moved", async () => {
    const half = big.split("\n").slice(0, 200).join("\n") + "\n";
    const rest = big.split("\n").slice(200).join("\n");
    const { result, calls, by } = await planFor({ "src/big.ts": 'export * from "./big/rest.ts"\n' + half, "src/big/rest.ts": rest });
    expect(result.moved).toBeGreaterThanOrEqual(200);
    expect(by("test-unit").layer).toBe("L2");
    expect(result.jevLines).toBeLessThan(20);
    const state = JSON.stringify(calls.map((c) => c.state));
    expect(state).toContain("moved from src/big.ts");
  });

  test("a big change that isn't a move still falls back to running", async () => {
    const fresh = Array.from({ length: 900 }, (_, i) => `export const fresh${i} = ${i}`).join("\n") + "\n";
    const { by } = await planFor({ "src/fresh.ts": fresh });
    expect(by("test-unit")).toMatchObject({ run: true, layer: "fallback" });
  });

  test("if Jev is unreachable, every job it would judge runs", async () => {
    const ask: Ask = async () => {
      throw new Error("Jev 503");
    };
    const { by } = await planFor({ "src/a.ts": "export const a = 2\n" }, { ask, calls: [] });
    expect(by("cli-macos")).toMatchObject({ run: true, layer: "fallback" });
    expect(by("test-flows-a")).toMatchObject({ run: true, layer: "fallback" });
  });

  test("the pass cache skips a job whose exact inputs already passed", async () => {
    const { dir, base } = repo();
    const head = commit(dir, { "src/a.ts": "export const a = 2\n" });
    const first = await plan({ repo: dir, base, head, config, ask: fakeJev(0.9).ask });
    const passed = new Set([`test-unit:${first.hashes["test-unit"]}`]);
    const second = await plan({ repo: dir, base, head, config, ask: fakeJev(0.9).ask, passed });
    expect(second.decisions.find((d) => d.job === "test-unit")).toMatchObject({ run: false, layer: "L1" });
  });
});

describe("markMoves", () => {
  test("lines removed from one file and added to another collapse into one marker", () => {
    const files: FileChange[] = [
      { path: "a.ts", status: "modified", binary: false, hunks: [{ at: "", removed: ["const one = 1", "const two = 2", "}"], added: ["import { one } from './b'"] }] },
      { path: "b.ts", status: "added", binary: false, hunks: [{ at: "", removed: [], added: ["  const one = 1", "}", "const two = 2", "const three = 3"] }] },
    ];
    expect(markMoves(files)).toBe(4);
    expect(files[1]!.hunks[0]!.view!.added).toEqual(["⟨3 lines moved from a.ts, unchanged⟩", "const three = 3"]);
    expect(files[0]!.hunks[0]!.view!.removed).toEqual(["⟨2 lines moved to b.ts, unchanged⟩", "}"]);
    expect(size(files[1]!)).toBe(2);
  });
});

describe("jev-ci.yml matches the repo", () => {
  test("each flows job's imports_from lists exactly its group's tests", () => {
    for (const [group, names] of Object.entries(FLOWS)) {
      const entries = config.jobs[`test-${group}`]!.imports_from!;
      for (const name of names) expect(matches(entries, `test/${name}.test.ts`)).toBe(true);
      const others = Object.entries(FLOWS)
        .filter(([g]) => g !== group)
        .flatMap(([, n]) => n);
      for (const name of others) expect(matches(entries, `test/${name}.test.ts`)).toBe(false);
    }
  });

  test("every check job in ci.yml has an entry or is another's part, and the rest are planner jobs", () => {
    const wf = Bun.YAML.parse(CI) as { jobs: Record<string, unknown> };
    const parts = Object.values(config.jobs).flatMap((j) => j.parts ?? []);
    for (const id of Object.keys(wf.jobs)) expect(Boolean(config.jobs[id]) || parts.includes(id) || Boolean(config.planner_jobs?.includes(id))).toBe(true);
    for (const id of parts) expect(wf.jobs[id]).toBeDefined();
  });
});

describe("pass markers", () => {
  const repo = { full_name: "kiwi-init/channels" };
  const fork = { full_name: "someone/channels" };
  const pr = (head: { full_name: string } | null): PullEvent => ({ repository: { default_branch: "main" }, pull_request: { number: 7, base: { repo }, head: { repo: head } } });
  const caches: PassCache[] = [
    { key: "jev-ci-pass-static-aaa", ref: "refs/heads/main" },
    { key: "jev-ci-pass-test-unit-bbb", ref: "refs/pull/7/merge" },
    { key: "jev-ci-pass-test-unit-ccc", ref: "refs/pull/8/merge" },
    { key: "jev-ci-pass-build-ddd", ref: "refs/heads/someone-else" },
  ];
  const jobs = ["static", "test-unit", "build"];

  test("a pull request from this repo trusts main's markers and its own runs', no other pull request's or branch's", () => {
    expect([...passMarkers(caches, jobs, trustedRef(pr(repo), "refs/pull/7/merge"))].sort()).toEqual(["static:aaa", "test-unit:bbb"]);
  });

  test("a pull request from a fork trusts only main's: its own runs could have written any marker", () => {
    expect([...passMarkers(caches, jobs, trustedRef(pr(fork), "refs/pull/7/merge"))]).toEqual(["static:aaa"]);
    expect([...passMarkers(caches, jobs, trustedRef(pr(null), "refs/pull/7/merge"))]).toEqual(["static:aaa"]);
  });

  test("no event or no ref trusts main alone, and the default branch comes from the event", () => {
    expect([...passMarkers(caches, jobs, trustedRef({}, undefined))]).toEqual(["static:aaa"]);
    expect([...passMarkers(caches, jobs, trustedRef(pr(repo), undefined))]).toEqual(["static:aaa"]);
    const trunk: PullEvent = { ...pr(repo), repository: { default_branch: "trunk" } };
    expect([...passMarkers([{ key: "jev-ci-pass-static-eee", ref: "refs/heads/trunk" }, ...caches], jobs, trustedRef(trunk, "refs/pull/7/merge"))].sort()).toEqual(["static:eee", "test-unit:bbb"]);
  });

  test("the merge queue's runs on main's queue are trusted like main's, by pull requests and merge groups alike (T2034)", () => {
    const queued: PassCache[] = [
      { key: "jev-ci-pass-build-qqq", ref: "refs/heads/gh-readonly-queue/main/pr-9-0123456789abcdef0123456789abcdef01234567" },
      { key: "jev-ci-pass-test-unit-rrr", ref: "refs/heads/gh-readonly-queue/release/pr-3-0123456789abcdef0123456789abcdef01234567" },
      { key: "jev-ci-pass-test-unit-sss", ref: "refs/heads/gh-readonly-queue-main/pr-1" },
      ...caches,
    ];
    expect([...passMarkers(queued, jobs, trustedRef(pr(repo), "refs/pull/7/merge"))].sort()).toEqual(["build:qqq", "static:aaa", "test-unit:bbb"]);
    const group: PullEvent = { repository: { default_branch: "main" }, merge_group: { base_sha: "a".repeat(40), head_sha: "b".repeat(40), head_ref: "refs/heads/gh-readonly-queue/main/pr-12-x" } };
    expect([...passMarkers(queued, jobs, trustedRef(group, "refs/heads/gh-readonly-queue/main/pr-12-x"))].sort()).toEqual(["build:qqq", "static:aaa"]);
  });

  test("a job split into shards passed only once every shard's marker is there, each from a trusted run", () => {
    const own = trustedRef(pr(repo), "refs/pull/7/merge");
    const shard = (i: number, ref = "refs/pull/7/merge"): PassCache => ({ key: `jev-ci-pass-cli-macos-fff-shard${i}of3`, ref });
    expect([...passMarkers([shard(1), shard(3)], ["cli-macos"], own)]).toEqual([]);
    expect([...passMarkers([shard(1), shard(2, "refs/heads/main"), shard(3)], ["cli-macos"], own)]).toEqual(["cli-macos:fff"]);
    expect([...passMarkers([shard(1), shard(2, "refs/pull/8/merge"), shard(3)], ["cli-macos"], own)]).toEqual([]);
    expect([...passMarkers([shard(1), { key: "jev-ci-pass-cli-macos-fff-shard2of2", ref: "refs/pull/7/merge" }, shard(3)], ["cli-macos"], own)]).toEqual([]);
  });
});

describe("the merge queue (T2034)", () => {
  const sha = (c: string) => c.repeat(40);

  test("a merge group is read as its base and head commits, and an event without them fails the plan so everything runs", () => {
    expect(mergeGroupRange({ merge_group: { base_sha: sha("a"), head_sha: sha("b"), head_ref: "refs/heads/gh-readonly-queue/main/pr-1-x" } })).toEqual({ base: sha("a"), head: sha("b") });
    for (const bad of [
      {},
      { merge_group: { head_sha: sha("b") } },
      { merge_group: { base_sha: "main", head_sha: sha("b") } },
      { merge_group: { base_sha: sha("a"), head_sha: `${sha("b")}; rm -rf /` } },
    ])
      expect(() => mergeGroupRange(bad)).toThrow("names no base_sha and head_sha");
  });

  test("a push to main skips its run only when a merge_group run of ci.yml passed on that very commit", () => {
    const run = (o: Partial<QueueRun>): QueueRun => ({ id: 1, event: "merge_group", path: ".github/workflows/ci.yml", head_sha: sha("c"), conclusion: "success", ...o });
    expect(testedByQueue([run({ id: 41 })], sha("c"), ".github/workflows/ci.yml")).toBe(41);
    expect(testedByQueue([run({ conclusion: "failure" }), run({ conclusion: null })], sha("c"), ".github/workflows/ci.yml")).toBeNull();
    expect(testedByQueue([run({ head_sha: sha("d") })], sha("c"), ".github/workflows/ci.yml")).toBeNull();
    expect(testedByQueue([run({ path: ".github/workflows/release.yml" })], sha("c"), ".github/workflows/ci.yml")).toBeNull();
    expect(testedByQueue([run({ event: "pull_request" })], sha("c"), ".github/workflows/ci.yml")).toBeNull();
    expect(testedByQueue([], sha("c"), ".github/workflows/ci.yml")).toBeNull();
  });

  test("a commit the queue already tested runs no job on main, parts included, and says why", () => {
    const skipped = skipAll(config, "the merge queue tested this commit as-is (run 41)");
    expect(skipped.decisions.filter((d) => d.run)).toEqual([]);
    expect(skipped.decisions.map((d) => d.job)).toContain("perf-runs");
    for (const d of skipped.decisions) expect(d.reason).toMatch(/merge queue tested this commit|does part of/);
  });

  test("a merge group is planned on its combined change: every queued pull request's files count, not only the last one's", async () => {
    const { dir, base } = repo();
    commit(dir, { "src/a.ts": "export const a = 10\n" });
    const head = commit(dir, { "web/src/lib/v.ts": "export const v = 30\n" });
    const by = (r: Plan, job: string) => r.decisions.find((d) => d.job === job)!;
    const group = await plan({ repo: dir, base, head, config, ask: fakeJev(0.9).ask });
    expect(by(group, "test-flows-b").run).toBe(true);
    expect(by(group, "perf").run).toBe(true);
    const lastOnly = await plan({ repo: dir, base: sh(dir, ["rev-parse", "HEAD^1"]), head, config, ask: fakeJev(0.9).ask });
    expect(by(lastOnly, "test-flows-b")).toMatchObject({ run: false, layer: "L0" });
    expect(by(lastOnly, "perf").run).toBe(true);
  });

  test("ci.yml answers the merge queue: it runs on merge_group's checks_requested, each group in a concurrency group of its own", () => {
    expect(CI).toMatch(/\n {2}merge_group:\n {4}types: \[checks_requested\]\n/);
    expect(CI).toContain("group: ci-${{ github.event.pull_request.number || github.event.merge_group.head_ref || github.run_id }}");
    expect(CI).toMatch(/\n {2}ci-ok:\n(?: .*\n)*? {4}if: always\(\)\n/);
  });
});

describe("a pull request runs only the fast checks, the merge queue the rest (T2134)", () => {
  test("jev-ci.yml names repo / static and test / unit, both jobs it plans", () => {
    expect(config.pull_request_jobs).toEqual(["static", "test-unit"]);
    for (const job of config.pull_request_jobs ?? []) expect(config.jobs[job]).toBeDefined();
  });

  test("on a pull request the fast jobs keep their plan and every other job that would run waits for the queue, with the reason it would run", async () => {
    const { result, by } = await planFor({ "src/a.ts": "export const a = 5\n", "web/src/lib/v.ts": "export const v = 9\n" }, fakeJev(0.9));
    const wouldRun = result.decisions.filter((d) => d.run).map((d) => d.job);
    expect(wouldRun.filter((j) => !["static", "test-unit"].includes(j)).length).toBeGreaterThan(0);
    const pr = pullRequestOnly(config, result);
    for (const d of pr.decisions) {
      if (["static", "test-unit"].includes(d.job) || !by(d.job).run) expect(d).toEqual(by(d.job));
      else expect(d).toMatchObject({ run: false, layer: "L0", reason: `a pull request runs only static and test-unit; its merge queue group runs this (${by(d.job).reason})` });
    }
  });

  test("a part goes with the job it belongs to, and a config without pull_request_jobs keeps the whole plan", () => {
    const all: Plan = { ...skipAll(config, "x"), decisions: skipAll(config, "x").decisions.map((d) => ({ ...d, run: true, reason: "changed" })) };
    const perf = pullRequestOnly({ ...config, pull_request_jobs: ["perf"] }, all);
    expect(
      perf.decisions
        .filter((d) => d.run)
        .map((d) => d.job)
        .sort(),
    ).toEqual(["perf", "perf-runs"]);
    expect(pullRequestOnly({ ...config, pull_request_jobs: undefined }, all)).toEqual(all);
  });
});

describe("jev-ci.yml stays merge-friendly (T2212)", () => {
  const lines = CONFIG_TEXT.split("\n");
  const jobs = lines.indexOf("jobs:");

  test("each job's inputs, imports_from, always and parts are block lists, one item per line, sorted", () => {
    const flow = lines.slice(jobs).filter((l) => /^ {4}(inputs|imports_from|always|parts): \[.+\]/.test(l));
    expect(flow).toEqual([]);
    for (let i = jobs; i < lines.length; i++) {
      if (!/^ {4}(inputs|imports_from|always|parts):$/.test(lines[i]!)) continue;
      const items: string[] = [];
      for (let j = i + 1; j < lines.length && lines[j]!.startsWith("      - "); j++) items.push(lines[j]!.slice(8));
      expect(items.length).toBeGreaterThan(0);
      expect(items).toEqual([...items].sort());
    }
  });

  test("each description is one sentence per line", () => {
    const run: string[] = [];
    for (let i = jobs; i < lines.length; i++) {
      if (lines[i] !== "    description: >-") continue;
      for (let j = i + 1; j < lines.length && lines[j]!.startsWith("      "); j++) if (/[.;:!?)] (?=[A-Z`('"])/.test(lines[j]!)) run.push(lines[j]!.slice(0, 80));
    }
    expect(run).toEqual([]);
  });
});
