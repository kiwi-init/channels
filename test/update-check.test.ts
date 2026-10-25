import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SCRIPTS = join(ROOT, "desktop/scripts/update-check");

type Step = { run?: string; uses?: string };
type Workflow = { on: Record<string, unknown>; env: Record<string, string>; jobs: Record<string, { "timeout-minutes"?: number; steps: Step[] }> };

const workflow = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/update-check.yml"), "utf8")) as Workflow;

test("the update check runs only when dispatched by hand, never on a push or a pull request", () => {
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.env).toEqual({ FROM: "${{ inputs.from }}", TO: "${{ inputs.to }}" });
});

test("every job checks the two versions before it downloads or runs anything, and has a time limit", () => {
  for (const [id, job] of Object.entries(workflow.jobs)) {
    expect({ id, timeout: (job["timeout-minutes"] ?? 0) > 0 }).toEqual({ id, timeout: true });
    const runs = job.steps.flatMap((s) => (s.run ? [s.run] : []));
    expect({ id, first: runs[0] }).toEqual({ id, first: 'bash desktop/scripts/update-check/versions.sh "$FROM" "$TO"' });
    for (const run of runs) expect({ id, run, inlined: /\$\{\{\s*inputs\./.test(run) }).toEqual({ id, run, inlined: false });
  }
});

test("each script parses, and the version check refuses anything but two Channels Livewire versions before touching the network (T1192)", () => {
  for (const f of readdirSync(SCRIPTS)) expect({ f, code: Bun.spawnSync(["bash", "-n", join(SCRIPTS, f)]).exitCode }).toEqual({ f, code: 0 });
  for (const args of [
    ["2026.10.2-livewire.2; rm -rf /", "2026.10.2-livewire.3"],
    ["2026.10.2-livewire.2", "v2026.10.2-livewire.3"],
    ["2026.10.2-livewire.2"],
    ["2026.10.2", "2026.10.3"],
    ["2026.10.2-livewire.2", "2026.10.2-rc.1"],
    ["2026.10-livewire.2", "2026.10.2-livewire.3"],
  ]) {
    const r = Bun.spawnSync(["bash", join(SCRIPTS, "versions.sh"), ...args], { env: { PATH: "/usr/bin:/bin", GITHUB_REPOSITORY: "o/r" } });
    expect({ args, code: r.exitCode }).toEqual({ args, code: 1 });
    expect(r.stdout.toString()).not.toContain("checking that");
  }
});
