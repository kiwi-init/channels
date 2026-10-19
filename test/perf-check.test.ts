import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const budgets = (await Bun.file("scripts/perf-budgets.json").json()) as Record<string, { budget: number; gate: number | null; nightly?: boolean }>;
const dir = mkdtempSync(join(tmpdir(), "kiwi-perf-check-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(tasksMs: number, i: number): string {
  const file = join(dir, `run-${i}.json`);
  writeFileSync(
    file,
    JSON.stringify({
      "@1x": { reloadToTasksMs: 900 },
      "@4x": { switchMedianMs: { Tasks: tasksMs, Agents: 90, Conversation: 95 } },
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

test("the soak's limits count only in the nightly run, and the gap to 0.20 is listed", () => {
  const files = [run(50, 7)];
  expect(check(files).out).not.toContain("Soak: heap growth per hour");
  expect(check(files, "--nightly").out).toContain("Soak: heap growth per hour");
  expect(check(files).out).toContain("Not yet at the 0.20 budget");
});
