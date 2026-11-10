import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Step {
  id?: string;
  run?: string;
}

const ci = Bun.YAML.parse(await Bun.file(".github/workflows/ci.yml").text()) as { jobs: Record<string, { steps?: Step[] }> };
const script = ci.jobs.plan?.steps?.find((s) => s.id === "plan")?.run;
if (!script) throw new Error("ci.yml's plan job has no step with id plan; update this test");

function plan(env: Record<string, string>): Record<string, boolean> {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-ci-plan-"));
  const out = join(dir, "out");
  try {
    const run = Bun.spawnSync(["bash", "-c", script ?? ""], { env: { PATH: process.env.PATH ?? "", GITHUB_OUTPUT: out, ...env } });
    if (run.exitCode !== 0) throw new Error(run.stdout.toString() + run.stderr.toString());
    return JSON.parse(readFileSync(out, "utf8").replace(/^run=/, "")) as Record<string, boolean>;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const picked = (r: Record<string, boolean>): string[] => Object.keys(r).filter((k) => r[k]);

describe("which jobs CI runs (T5174)", () => {
  test("a pull request runs repo / static and test / unit", () => {
    expect(picked(plan({ EVENT: "pull_request", TITLE: "Linux: a kiwi:// link raises the running window" }))).toEqual(["static", "test-unit"]);
  });

  test("a release's stamp PR also runs cli / macos, the release's Mac tests and packing, before the tag", () => {
    for (const title of ["kiwi 2026.11.10", "kiwi 2026.12.0-rc.2"]) expect(picked(plan({ EVENT: "pull_request", TITLE: title }))).toEqual(["static", "test-unit", "cli-macos"]);
    for (const title of ["kiwi 2026.11", "Docs: kiwi 2026.11.1", "kiwi 2026.11.10 and more"]) expect(picked(plan({ EVENT: "pull_request", TITLE: title }))).toEqual(["static", "test-unit"]);
  });

  test("a dispatch runs the jobs it names, a named distros takes its linux producer, an unnamed dispatch never takes distros, and a push runs all but the phones", () => {
    expect(picked(plan({ EVENT: "workflow_dispatch", JOBS: "cli-macos,build" }))).toEqual(["build", "cli-macos"]);
    expect(picked(plan({ EVENT: "workflow_dispatch", JOBS: "desktop-distros" }))).toEqual(["desktop-distros", "desktop-linux"]);
    const push = plan({ EVENT: "push" });
    expect(Object.keys(push).filter((k) => !push[k])).toEqual(["ios", "android"]);
    const unnamed = picked(plan({ EVENT: "workflow_dispatch", JOBS: "" }));
    expect(unnamed).not.toContain("desktop-distros");
  });

  test("the retired phone jobs run only when a dispatch names them", () => {
    expect(picked(plan({ EVENT: "workflow_dispatch", JOBS: "ios,android" }))).toEqual(["ios", "android"]);
    expect(() => plan({ EVENT: "workflow_dispatch", JOBS: "iphone" })).toThrow("no job named iphone");
  });
});
