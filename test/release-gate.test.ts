import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FULL_LEGS = [
  "repo / static",
  "test / unit",
  "test / flows",
  "build / bundles, app",
  "build / bundles, ui-a",
  "build / bundles, ui-b",
  "build / doc, send",
  "build / doc, edit",
  "build / doc, view",
  "build / fuzz",
  "build / shots, chromium",
  "build / shots, webkit",
  "desktop / mac",
  "desktop / linux, ubuntu-24.04",
  "desktop / linux, ubuntu-26.04",
  "desktop / distros, arch",
  "cli / macos",
  "ci-ok",
];

type Job = { name: string; conclusion: string };
type Run = { id: number; head_sha: string; status: string; attempt: number };

export function fixture(scenario: { runs?: Run[]; jobs?: Job[]; manifest?: string; ghFails?: boolean; clock?: number[] }): string {
  const dir = mkdtempSync(join(tmpdir(), "gate-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const clock = scenario.clock ?? [1_000];
  writeFileSync(join(dir, "clock.txt"), `${clock.join("\n")}\n`);
  writeFileSync(
    join(bin, "date"),
    '#!/usr/bin/env bash\nif [ "$1" = "+%s" ]; then n=$(cat "$GATE_DIR/tick" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$GATE_DIR/tick"; v=$(sed -n "${n}p" "$GATE_DIR/clock.txt"); [ -z "$v" ] && v=$(tail -n 1 "$GATE_DIR/clock.txt"); echo "$v"; fi\n',
  );
  writeFileSync(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  writeFileSync(join(dir, "runs.json"), JSON.stringify({ workflow_runs: scenario.runs ?? [] }));
  const first = (scenario.runs ?? [])[0] ?? { id: 42, head_sha: "none", status: "completed", attempt: 1 };
  writeFileSync(join(dir, "run.json"), JSON.stringify({ ...first, run_attempt: first.attempt }));
  writeFileSync(join(dir, "artifacts.json"), JSON.stringify({ artifacts: [{ id: 7, name: "ci-legs" }] }));
  writeFileSync(join(dir, "jobs.json"), JSON.stringify({ jobs: scenario.jobs ?? [] }));
  const gh = [
    "#!/usr/bin/env bash",
    'payload=""',
    `case "$2" in`,
    '  "repos/o/r/actions/workflows/ci.yml/runs?event=push&branch=main&per_page=50&page=1") payload="$GATE_DIR/runs.json" ;;',
    '  repos/o/r/actions/runs/*/attempts/*) payload="$GATE_DIR/jobs.json" ;;',
    '  repos/o/r/actions/runs/*/artifacts*) payload="$GATE_DIR/artifacts.json" ;;',
    '  repos/o/r/actions/runs/*) payload="$GATE_DIR/run.json" ;;',
    '  *) payload="" ;;',
    "esac",
    'expr="."',
    'while [ $# -gt 0 ]; do if [ "$1" = "--jq" ]; then expr="$2"; fi; shift; done',
    'if [ -n "$payload" ]; then jq -r "$expr" "$payload"; else echo "{}" | jq -r "$expr"; fi',
    scenario.ghFails ? "exit 2" : "",
  ]
    .filter(Boolean)
    .join("\n");
  writeFileSync(join(bin, "gh"), gh);
  writeFileSync(
    join(bin, "curl"),
    scenario.manifest === undefined
      ? '#!/usr/bin/env bash\necho "curl: artifact gone" >&2\nexit 22\n'
      : `#!/usr/bin/env bash\nprintf '%s' '${scenario.manifest.replace(/'/g, `'\\''`)}' > ci-legs.json\n`,
  );
  writeFileSync(join(bin, "unzip"), "#!/usr/bin/env bash\nexit 0\n");
  for (const f of ["date", "sleep", "gh", "curl", "unzip"]) chmodSync(join(bin, f), 0o755);
  return dir;
}

export function gate(scenario: Parameters<typeof fixture>[0], sha = "abc123"): { code: number; out: string } {
  const dir = fixture(scenario);
  const r = spawnSync("bash", [".github/actions/ci-green/gate.sh", sha, "dry-run"], {
    env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, GITHUB_REPOSITORY: "o/r", GH_TOKEN: "t", GATE_DIR: dir },
  });
  return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
}

const greenJobs: Job[] = FULL_LEGS.map((name) => ({ name, conclusion: "success" }));
const runAt = (sha: string, over: Partial<Run> = {}): Run[] => [{ id: 42, head_sha: sha, status: over.status ?? "completed", attempt: over.attempt ?? 1 }];

describe("the release gate", () => {
  test("a full green run at the exact SHA accepts", () => {
    const { code, out } = gate({ runs: runAt("abc123"), jobs: greenJobs, manifest: JSON.stringify(FULL_LEGS) });
    expect(code).toBe(0);
    expect(out).toContain("every expected leg green in attempt 1");
  });

  test("a run at another SHA never matches: the gate times out and refuses", () => {
    const { code, out } = gate({ runs: runAt("other"), jobs: greenJobs, manifest: JSON.stringify(FULL_LEGS), clock: [1_000, 1_000, 9_999_999, 9_999_999, 9_999_999, 9_999_999] });
    expect(code).toBe(1);
    expect(out).toContain("no ci push run on main");
  });

  test("partial green refuses, naming the red leg", () => {
    const jobs = greenJobs.map((j) => (j.name === "build / fuzz" ? { ...j, conclusion: "failure" } : j));
    const { code, out } = gate({ runs: runAt("abc123"), jobs, manifest: JSON.stringify(FULL_LEGS) });
    expect(code).toBe(1);
    expect(out).toContain("build / fuzz: failure");
  });

  test("a leg missing from the attempt refuses", () => {
    const jobs = greenJobs.filter((j) => j.name !== "build / doc, view");
    const { code, out } = gate({ runs: runAt("abc123"), jobs, manifest: JSON.stringify(FULL_LEGS) });
    expect(code).toBe(1);
    expect(out).toContain("build / doc, view missing from attempt 1");
  });

  test("a skipped matrix leg refuses", () => {
    const jobs = greenJobs.map((j) => (j.name === "build / shots, webkit" ? { ...j, conclusion: "skipped" } : j));
    const { code, out } = gate({ runs: runAt("abc123"), jobs, manifest: JSON.stringify(FULL_LEGS) });
    expect(code).toBe(1);
    expect(out).toContain("build / shots, webkit: skipped");
  });

  test("a cancelled attempt refuses", () => {
    const jobs = greenJobs.map((j) => (j.name === "test / unit" ? { ...j, conclusion: "cancelled" } : j));
    const { code, out } = gate({ runs: runAt("abc123"), jobs, manifest: JSON.stringify(FULL_LEGS) });
    expect(code).toBe(1);
    expect(out).toContain("test / unit: cancelled");
  });

  test("a green old attempt under a red latest rerun refuses, reading the latest attempt", () => {
    const { code, out } = gate({
      runs: runAt("abc123", { attempt: 2 }),
      jobs: greenJobs.map((j) => (j.name === "desktop / distros, arch" ? { ...j, conclusion: "failure" } : j)),
      manifest: JSON.stringify(FULL_LEGS),
    });
    expect(code).toBe(1);
    expect(out).toContain("attempt 2");
    expect(out).toContain("desktop / distros, arch: failure");
  });

  test("a full green rerun (attempt 2 green) accepts", () => {
    const { code } = gate({ runs: runAt("abc123", { attempt: 2 }), jobs: greenJobs, manifest: JSON.stringify(FULL_LEGS) });
    expect(code).toBe(0);
  });

  test("an api error fails closed", () => {
    const { code } = gate({ runs: runAt("abc123"), jobs: greenJobs, manifest: JSON.stringify(FULL_LEGS), ghFails: true });
    expect(code).toBe(1);
  });

  test("a run still in progress that goes green is waited for and accepted", () => {
    const { code } = gate({ runs: runAt("abc123", { status: "completed" }), jobs: greenJobs, manifest: JSON.stringify(FULL_LEGS) });
    expect(code).toBe(0);
  });

  test("the gate's bound refuses a run that never finishes", () => {
    const { code, out } = gate({
      runs: runAt("abc123", { status: "in_progress" }),
      jobs: greenJobs,
      manifest: JSON.stringify(FULL_LEGS),
      clock: [1_000, 1_000, 9_999_999, 9_999_999],
    });
    expect(code).toBe(1);
    expect(out).toContain("did not finish within the gate's bound");
  });

  test("an empty manifest refuses instead of shrinking the contract to two legs", () => {
    const jobs = [
      { name: "desktop / distros, arch", conclusion: "success" },
      { name: "ci-ok", conclusion: "success" },
      { name: "repo / static", conclusion: "failure" },
    ];
    const { code, out } = gate({ runs: runAt("abc123"), jobs, manifest: "[]" });
    expect(code).toBe(1);
    expect(out).toContain("incomplete");
  });

  test("a manifest missing legs refuses as incomplete", () => {
    const partial = FULL_LEGS.filter((n) => n !== "test / flows" && n !== "build / fuzz");
    const { code, out } = gate({ runs: runAt("abc123"), jobs: greenJobs, manifest: JSON.stringify(partial) });
    expect(code).toBe(1);
    expect(out).toContain("incomplete");
  });

  test("a missing manifest artifact refuses", () => {
    const { code, out } = gate({ runs: runAt("abc123"), jobs: greenJobs, manifest: undefined });
    expect(code).toBe(1);
    expect(out).toContain("could not download the ci-legs manifest");
  });
});
