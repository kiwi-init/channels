import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { reference, limits: budgets } = (await Bun.file("scripts/perf-budgets.json").json()) as {
  reference: Record<"@1x" | "@4x", number>;
  calibration: Record<"@1x" | "@4x" | "ratio", [number, number]>;
  limits: Record<string, { at: string[]; per?: "@1x" | "@4x"; budget: number; gate: number | null; nightly?: boolean }>;
};
const dir = mkdtempSync(join(tmpdir(), "kiwi-perf-check-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(tasksMs: number, i: number, speed = 1, calibrated = true, at: Partial<Record<"@1x" | "@4x", number>> = {}, reload = { total: 500, inPage: 425 }): string {
  const file = join(dir, `run-${i}.json`);
  const calibration = (s: "@1x" | "@4x") => (calibrated ? { calibrationMs: at[s] ?? reference[s] * speed } : {});
  writeFileSync(
    file,
    JSON.stringify({
      "@1x": { reloadToTasksMs: reload.total, ...calibration("@1x") },
      "reload, in page": { firstScreenMs: reload.inPage },
      "@4x": { switchMedianMs: { Tasks: tasksMs, Agents: 90, Conversation: 95 }, ...calibration("@4x") },
      "typing while 10 agents post": { p95Ms: 30 },
      soak: { heapSlopeMBPerHour: 60, nodesSlopePerHour: 152000, listenersSlopePerHour: 22000 },
    }),
  );
  return file;
}

const check = (files: string[], ...flags: string[]) => {
  const r = Bun.spawnSync(["bun", "scripts/perf-check.ts", ...flags, ...files]);
  return { code: r.exitCode, out: r.stdout.toString() };
};

test("every limit has a budget, and a gate is either unset or no tighter than its budget", () => {
  for (const [name, l] of Object.entries(budgets)) {
    expect({ name, budget: l.budget > 0 }).toEqual({ name, budget: true });
    if (l.gate !== null) expect({ name, ok: l.gate >= l.budget }).toEqual({ name, ok: true });
  }
});

test("the median of the runs is what's compared: one slow run doesn't fail, a slow median does", () => {
  const gate = budgets.tasksMs!.gate;
  if (gate === null) return;
  expect(check([run(gate - 10, 1), run(gate * 3, 2), run(gate - 5, 3)]).code).toBe(0);
  const r = check([run(gate + 10, 4), run(gate + 20, 5), run(gate - 5, 6)]);
  expect(r.code).toBe(1);
  expect(r.out).toContain("Tasks tab @4x");
});

test("timings are scaled by each run's calibration: a slow runner's numbers aren't a regression", () => {
  const gate = budgets.tasksMs!.gate;
  if (gate === null) return;
  const slow = check([run(gate * 1.5, 8, 2), run(gate * 1.6, 9, 2), run(gate * 1.4, 10, 2)]);
  expect(slow.code).toBe(0);
  expect(slow.out).toContain(`| Tasks tab @4x | ${gate * 1.5} | ${gate * 0.75} |`);
  expect(check([run(gate * 1.5, 11), run(gate * 1.6, 12), run(gate * 1.4, 13)]).code).toBe(1);
});

test("a timing without its run's calibration counts as not measured", () => {
  const r = check([run(50, 14, 1, false)]);
  expect(r.code).toBe(1);
  expect(r.out).toContain("Tasks tab @4x: not measured");
});

test("a run whose calibration is out of range is left out of the scaled timings, and the output says why", () => {
  const gate = budgets.tasksMs!.gate;
  if (gate === null) return;
  const skewed = run(gate * 3, 15, 1, true, { "@4x": reference["@1x"] * 5.11 });
  const r = check([run(gate - 10, 16), skewed, run(gate - 5, 17)]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("Left out of the scaled timings (2 of 3 runs kept):");
  expect(r.out).toContain("run-15.json: its @4x/@1x calibration ratio 5.11 is outside 3-5");
  const absurd = check([run(5000, 18, 1, true, { "@1x": 1e6, "@4x": 4e6 }), run(5000, 19, 1, true, { "@1x": 1e6, "@4x": 4e6 }), run(5000, 20)]);
  expect(absurd.code).toBe(1);
  expect(absurd.out).toContain("run-18.json: its @1x calibration 1000000 ms is outside 40-250");
  expect(absurd.out).toContain("Tasks tab @4x: not measured (1 of 3 runs can be scaled, 2 needed)");
});

test("runs without a calibration are named, and too few calibrated runs fail the scaled gates", () => {
  const r = check([run(50, 21), run(2000, 22, 1, false), run(2000, 23, 1, false)]);
  expect(r.code).toBe(1);
  expect(r.out).toContain("run-22.json: it has no calibration");
  expect(r.out).toContain("Reload to first screen: not measured (1 of 3 runs can be scaled, 2 needed)");
});

test("Reload scales only its in-page part: the rest of the reload doesn't follow page CPU", () => {
  const fast = (i: number) => run(50, i, 0.5, true, {}, { total: 500, inPage: 425 });
  const r = check([fast(24), fast(25), fast(26)]);
  expect(r.out).toContain("| Reload to first screen | 500 | 925 |");
  expect(check([run(50, 27, 1, true, {}, { total: 500, inPage: -1 }), run(50, 28, 1, true, {}, { total: 500, inPage: -1 })]).out).toContain("Reload to first screen: not measured");
});

test("every timing with a gate is scaled by the calibration at its CPU speed", () => {
  for (const [name, l] of Object.entries(budgets)) if (l.gate !== null) expect({ name, per: l.per }).toEqual({ name, per: l.at[0] === "@4x" ? "@4x" : "@1x" });
});

test("the soak's limits count only in the nightly run, and the gap to 0.20 is listed", () => {
  const files = [run(50, 7)];
  expect(check(files).out).not.toContain("Soak: heap growth per hour");
  expect(check(files, "--nightly").out).toContain("Soak: heap growth per hour");
  expect(check(files).out).toContain("Not yet at the 0.20 budget");
});

test("every workflow step that pipes perf-check runs under pipefail, so an over-gate median fails it", () => {
  const steps = [".github/workflows/ci.yml", ".github/workflows/nightly.yml"].flatMap((path) => {
    const wf = Bun.YAML.parse(readFileSync(path, "utf8")) as { jobs: Record<string, { steps?: { run?: string; shell?: string }[] }> };
    return Object.values(wf.jobs).flatMap((job) => (job.steps ?? []).filter((step) => step.run?.includes("perf-check.ts")).map((step) => ({ path, ...step })));
  });
  expect(steps.length).toBeGreaterThanOrEqual(2);
  for (const { path, run, shell } of steps) if (run!.includes("|")) expect({ path, shell }).toEqual({ path, shell: "bash" });
});
