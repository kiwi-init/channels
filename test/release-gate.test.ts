import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
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

export function fixture(scenario: {
  runs?: Run[];
  runsPage2?: Run[];
  jobs?: Job[];
  jobsPage2?: Job[];
  attemptJobs?: Record<number, Job[]>;
  statusSeq?: string[];
  manifest?: string;
  ghFails?: boolean;
  statusFailsOnce?: boolean;
  clock?: number[];
}): string {
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
  writeFileSync(join(dir, "runs2.json"), JSON.stringify({ workflow_runs: scenario.runsPage2 ?? [] }));
  const first = (scenario.runs ?? [])[0] ?? { id: 42, head_sha: "none", status: "completed", attempt: 1 };
  writeFileSync(join(dir, "run.json"), JSON.stringify({ ...first, run_attempt: first.attempt }));
  writeFileSync(join(dir, "artifacts.json"), JSON.stringify({ artifacts: [{ id: 7, name: "ci-legs" }] }));
  writeFileSync(join(dir, "jobs.json"), JSON.stringify({ jobs: scenario.jobs ?? [] }));
  writeFileSync(join(dir, "jobs2.json"), JSON.stringify({ jobs: scenario.jobsPage2 ?? [] }));
  for (const [attempt, jobs] of Object.entries(scenario.attemptJobs ?? {})) writeFileSync(join(dir, `jobs-a${attempt}.json`), JSON.stringify({ jobs }));
  writeFileSync(join(dir, "status.txt"), (scenario.statusSeq ?? ["completed"]).join("\n") + "\n");
  const gh = [
    "#!/usr/bin/env bash",
    'echo "$2" >> "$GATE_DIR/calls"',
    'payload=""',
    'case "$2" in',
    '  repos/o/r/actions/workflows/ci.yml/runs*) sha=$(echo "$2" | sed -E "s#.*head_sha=([^&]+).*#\\1#"); base="$GATE_DIR/runs.json"; [ "${2#*page=2}" != "$2" ] && base="$GATE_DIR/runs2.json"; jq -c --arg s "$sha" \'{workflow_runs: [.workflow_runs[]? | select(.head_sha == $s)]}\' "$base"; exit 0 ;;',
    '  repos/o/r/actions/runs/*/attempts/*/jobs*) url="$2"; a=$(echo "$url" | sed -E "s#.*/attempts/([0-9]+)/jobs.*#\\1#"); pg=$(echo "$url" | sed -E "s#.*[&?]page=([0-9]+).*#\\1#"); if [ -f "$GATE_DIR/jobs-a$a.json" ] && [ "$pg" = "1" ]; then payload="$GATE_DIR/jobs-a$a.json"; elif [ "$pg" = "2" ]; then payload="$GATE_DIR/jobs2.json"; else payload="$GATE_DIR/jobs.json"; fi ;;',
    '  repos/o/r/actions/runs/*/artifacts*) payload="$GATE_DIR/artifacts.json" ;;',
    '  repos/o/r/actions/runs/*) if [ "$3" = "--jq" ] && [ "$4" = ".status" ]; then if [ -s "$GATE_DIR/status-err" ]; then rm "$GATE_DIR/status-err"; echo "api down" >&2; exit 2; fi; n=$(cat "$GATE_DIR/scount" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$GATE_DIR/scount"; v=$(sed -n "${n}p" "$GATE_DIR/status.txt"); [ -z "$v" ] && v=$(tail -n 1 "$GATE_DIR/status.txt"); echo "$v"; exit 0; fi; payload="$GATE_DIR/run.json" ;;',
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
  if (scenario.statusFailsOnce) writeFileSync(join(dir, "status-err"), "1");
  for (const f of ["date", "sleep", "gh", "curl", "unzip"]) chmodSync(join(bin, f), 0o755);
  return dir;
}

function gate(scenario: Parameters<typeof fixture>[0], sha = "abc123"): { code: number; out: string; calls: string } {
  const dir = fixture(scenario);
  const r = spawnSync("bash", [".github/actions/ci-green/gate.sh", sha, "dry-run"], {
    env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, GITHUB_REPOSITORY: "o/r", GH_TOKEN: "t", GATE_DIR: dir },
  });
  const calls = (() => {
    try {
      return readFileSync(join(dir, "calls"), "utf8");
    } catch {
      return "";
    }
  })();
  return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}`, calls };
}

const greenJobs: Job[] = FULL_LEGS.map((name) => ({ name, conclusion: "success" }));
const red = (leg: string, conclusion = "failure"): Job[] => greenJobs.map((j) => (j.name === leg ? { ...j, conclusion } : j));
const runAt = (sha: string, over: Partial<Run> = {}): Run[] => [{ id: 42, head_sha: sha, status: over.status ?? "completed", attempt: over.attempt ?? 1 }];
const manifest = JSON.stringify(FULL_LEGS);

describe("the release gate", () => {
  test("a full green run at the exact SHA accepts", () => {
    const { code, out } = gate({ runs: runAt("abc123"), jobs: greenJobs, manifest });
    expect(code).toBe(0);
    expect(out).toContain("every expected leg green in attempt 1");
  });

  test("the required legs found beyond jobs page 1 still accept", () => {
    const fillers: Job[] = Array.from({ length: 100 }, (_, i) => ({ name: `filler ${i}`, conclusion: "success" }));
    const { code, out } = gate({ runs: runAt("abc123"), jobs: fillers, jobsPage2: greenJobs, manifest });
    expect(code).toBe(0);
    expect(out).toContain("every expected leg green");
  });

  test("a run found beyond runs page 1 accepts", () => {
    const fillers: Run[] = Array.from({ length: 50 }, (_, i) => ({ id: 1000 + i, head_sha: "abc123", status: "completed", attempt: 1 }));
    const { code } = gate({ runs: fillers, runsPage2: runAt("abc123"), jobs: greenJobs, manifest });
    expect(code).toBe(0);
  });

  test("a run at another SHA never matches: the gate times out and refuses", () => {
    const { code, out } = gate({ runs: runAt("other"), jobs: greenJobs, manifest, clock: [1_000, 1_000, 9_999_999, 9_999_999] });
    expect(code).toBe(1);
    expect(out).toContain("no ci push run on main");
  });

  test("partial green refuses, naming the red leg", () => {
    const { code, out } = gate({ runs: runAt("abc123"), jobs: red("build / fuzz"), manifest });
    expect(code).toBe(1);
    expect(out).toContain("build / fuzz: failure");
  });

  test("a leg missing from the attempt refuses", () => {
    const { code, out } = gate({ runs: runAt("abc123"), jobs: greenJobs.filter((j) => j.name !== "build / doc, view"), manifest });
    expect(code).toBe(1);
    expect(out).toContain("build / doc, view missing from attempt 1");
  });

  test("a skipped matrix leg refuses", () => {
    const { code, out } = gate({ runs: runAt("abc123"), jobs: red("build / shots, webkit", "skipped"), manifest });
    expect(code).toBe(1);
    expect(out).toContain("build / shots, webkit: skipped");
  });

  test("a cancelled attempt refuses", () => {
    const { code, out } = gate({ runs: runAt("abc123"), jobs: red("test / unit", "cancelled"), manifest });
    expect(code).toBe(1);
    expect(out).toContain("test / unit: cancelled");
  });

  test("a green old attempt under a red latest rerun refuses, having read the latest attempt", () => {
    const { code, out, calls } = gate({
      runs: runAt("abc123", { attempt: 2 }),
      attemptJobs: { 1: greenJobs, 2: red("desktop / distros, arch") },
      manifest,
    });
    expect(code).toBe(1);
    expect(out).toContain("attempt 2");
    expect(out).toContain("desktop / distros, arch: failure");
    expect(calls).toContain("attempts/2/jobs");
    expect(calls).not.toContain("attempts/1/jobs");
  });

  test("a full green rerun (attempt 2 green) accepts, reading attempt 2's jobs", () => {
    const { code, calls } = gate({ runs: runAt("abc123", { attempt: 2 }), attemptJobs: { 1: red("build / fuzz"), 2: greenJobs }, manifest });
    expect(code).toBe(0);
    expect(calls).toContain("attempts/2/jobs");
  });

  test("an api error fails closed", () => {
    const { code } = gate({ runs: runAt("abc123"), jobs: greenJobs, manifest, ghFails: true });
    expect(code).toBe(1);
  });

  test("a status read that errors once fails closed, even if the next read would say completed", () => {
    const { code, out } = gate({ runs: runAt("abc123"), jobs: greenJobs, manifest, statusFailsOnce: true, statusSeq: ["in_progress", "completed"] });
    expect(code).toBe(1);
    expect(out).toContain("could not read push run");
  });

  test("a run in progress is waited for and then accepted", () => {
    const { code } = gate({ runs: runAt("abc123"), jobs: greenJobs, manifest, statusSeq: ["in_progress", "in_progress", "completed"] });
    expect(code).toBe(0);
  });

  test("the gate's bound refuses a run that never finishes", () => {
    const { code, out } = gate({
      runs: runAt("abc123", { status: "in_progress" }),
      jobs: greenJobs,
      manifest,
      statusSeq: ["in_progress"],
      clock: [1_000, 1_000, 9_999_999, 9_999_999],
    });
    expect(code).toBe(1);
    expect(out).toContain("did not finish within the gate's bound");
  });

  test("an empty manifest refuses instead of shrinking the contract to two legs", () => {
    const jobs: Job[] = [
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
