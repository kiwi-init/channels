import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FLOWS } from "../scripts/ci-flows.ts";
import { loadConfig, matches, type Config } from "../.github/jev-ci/config.ts";
import { markMoves, size, type FileChange } from "../.github/jev-ci/diff.ts";
import { passMarkers, trustedRef, type PassCache, type PullEvent } from "../.github/jev-ci/github.ts";
import type { Request } from "../.github/jev-ci/jev.ts";
import { plan, type Ask, type Decision, type Plan } from "../.github/jev-ci/plan.ts";

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
const CHECKS = ["static", "test-unit", "test-flows-a", "test-flows-b", "build", "shots", "perf-runs", "perf", "desktop", "cli-macos"];

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
    const { result, by } = await planFor({ ".github/workflows/ci.yml": CI.replace(" --timings=test/macos-timings.json", " --timings=test/macos-timings.json --bail") });
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
      ".github/jev-ci.yml": CONFIG_TEXT.replace('"test/owner.ts", "test/owner-cli.ts", "test/check.ts"]', '"test/owner.ts", "test/owner-cli.ts", "test/check.ts", "test/other.ts"]'),
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
  const repo = { full_name: "ojowwalker77/channels" };
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

  test("a job split into shards passed only once every shard's marker is there, each from a trusted run", () => {
    const own = trustedRef(pr(repo), "refs/pull/7/merge");
    const shard = (i: number, ref = "refs/pull/7/merge"): PassCache => ({ key: `jev-ci-pass-cli-macos-fff-shard${i}of3`, ref });
    expect([...passMarkers([shard(1), shard(3)], ["cli-macos"], own)]).toEqual([]);
    expect([...passMarkers([shard(1), shard(2, "refs/heads/main"), shard(3)], ["cli-macos"], own)]).toEqual(["cli-macos:fff"]);
    expect([...passMarkers([shard(1), shard(2, "refs/pull/8/merge"), shard(3)], ["cli-macos"], own)]).toEqual([]);
    expect([...passMarkers([shard(1), { key: "jev-ci-pass-cli-macos-fff-shard2of2", ref: "refs/pull/7/merge" }, shard(3)], ["cli-macos"], own)]).toEqual([]);
  });
});
