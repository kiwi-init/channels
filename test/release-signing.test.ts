import { expect, test } from "bun:test";

const workflow = await Bun.file(".github/workflows/release-build.yml").text();

const run = (rehearsal: string) => Bun.spawnSync(["bun", "desktop/scripts/eb-release.ts", "missing-release-eb", "missing-out"], { env: { PATH: process.env["PATH"] ?? "", REHEARSAL: rehearsal } });

test("a tag release without the Mac signing secrets fails instead of publishing an unsigned app", () => {
  const r = run("false");
  expect(r.exitCode).toBe(1);
  expect(r.stderr.toString()).toContain("can't publish an unsigned Mac app");
});

test("a rehearsal goes on unsigned without the secrets", () => {
  expect(run("true").stderr.toString()).not.toContain("can't publish an unsigned Mac app");
});

test("the release builds only the Electrobun app, for Apple silicon and Linux, every time (T445, T580)", () => {
  expect(workflow).not.toContain("electrobun_mac");
  expect(workflow).not.toContain("electron-builder");
  expect(workflow).not.toContain("desktop-mac-x64");
  const job = (id: string): string => {
    const from = workflow.indexOf(`\n  ${id}:\n`);
    if (from < 0) throw new Error(`no ${id} job in release-build.yml`);
    const next = workflow.slice(from + 1).search(/\n {2}[a-z0-9-]+:\n/);
    return next < 0 ? workflow.slice(from) : workflow.slice(from, from + 1 + next);
  };
  for (const id of ["desktop-mac-eb", "desktop-linux-eb"]) {
    expect(job(id)).not.toContain("\n    if:");
    expect(job(id)).toContain("bun desktop/scripts/eb-driver-check.ts --release ");
    expect(job(id)).toContain("        if: ${{ !inputs.rehearsal || github.event_name == 'workflow_dispatch' }}\n        uses: actions/upload-artifact@");
    expect(job(id)).toContain("          name: ${{ inputs.rehearsal && 'rehearsal' || 'release' }}-desktop-");
    expect(job(id)).toContain("          retention-days: ${{ inputs.rehearsal && 3 || 0 }}\n");
  }
  expect(job("desktop-linux-eb")).toContain("    runs-on: ubuntu-24.04\n");
  expect(job("desktop-linux-eb")).toContain("bash desktop/scripts/linux-upgrade-check.sh out");
});

test("the Mac app's signing step gets the rehearsal input", () => {
  const from = workflow.indexOf("      - name: Sign, notarize and package\n");
  const env = workflow.slice(from, workflow.indexOf("        run: |", from));
  expect(env).toContain("          REHEARSAL: ${{ inputs.rehearsal }}\n");
});
