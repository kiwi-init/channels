import { expect, test } from "bun:test";

const workflow = await Bun.file(".github/workflows/release-build.yml").text();

function signingStep(): string {
  const from = workflow.indexOf("          sign=()\n");
  const to = workflow.indexOf("          cli bun-darwin-x64 && signcli", from);
  if (from < 0 || to < 0) throw new Error("the Package step's signing block moved; update this test");
  return workflow.slice(from, to);
}

const run = (rehearsal: string) => Bun.spawnSync(["bash", "-c", signingStep()], { env: { PATH: process.env["PATH"] ?? "", REHEARSAL: rehearsal } });

test("a tag release without the Mac signing secrets fails instead of publishing an unsigned app", () => {
  const r = run("false");
  expect(r.exitCode).toBe(1);
  expect(r.stdout.toString()).toContain("can't publish an unsigned Mac app");
});

test("a rehearsal still builds unsigned without the secrets", () => {
  const r = run("true");
  expect({ code: r.exitCode, out: r.stdout.toString().trim() }).toEqual({ code: 0, out: "no signing secrets: building unsigned" });
});

test("Electron builds only the Intel Mac app: Apple silicon and Linux ship the Electrobun app, built every time (T445)", () => {
  expect(workflow).not.toContain("electrobun_mac");
  expect(workflow).not.toContain("electron-builder --linux");
  expect(workflow).not.toContain("electron-builder --mac --arm64");
  expect(workflow).toContain('bunx electron-builder --mac --x64 --publish never "${sign[@]}"');
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

test("the Package step gets the rehearsal input", () => {
  const from = workflow.indexOf("      - name: Package\n");
  const env = workflow.slice(from, workflow.indexOf("        run: |", from));
  expect(env).toContain("          REHEARSAL: ${{ inputs.rehearsal }}\n");
});
