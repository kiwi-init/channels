import { expect, test } from "bun:test";

const workflow = await Bun.file(".github/workflows/release-build.yml").text();

function signingStep(os: string): string {
  const from = workflow.indexOf("          sign=()\n");
  const to = workflow.indexOf('          case "${{ runner.os }}" in', from);
  if (from < 0 || to < 0) throw new Error("the Package step's signing block moved; update this test");
  return workflow.slice(from, to).replaceAll("${{ runner.os }}", os);
}

const run = (os: string, rehearsal: string) => Bun.spawnSync(["bash", "-c", signingStep(os)], { env: { PATH: process.env["PATH"] ?? "", REHEARSAL: rehearsal } });

test("a tag release without the Mac signing secrets fails instead of publishing an unsigned app", () => {
  const r = run("macOS", "false");
  expect(r.exitCode).toBe(1);
  expect(r.stdout.toString()).toContain("can't publish an unsigned Mac app");
});

test("a rehearsal and the Linux build still build unsigned without the secrets", () => {
  for (const [os, rehearsal] of [
    ["macOS", "true"],
    ["Linux", "false"],
    ["Linux", "true"],
  ] as const) {
    const r = run(os, rehearsal);
    expect({ os, rehearsal, code: r.exitCode, out: r.stdout.toString().trim() }).toEqual({ os, rehearsal, code: 0, out: "no signing secrets: building unsigned" });
  }
});

test("the Package step gets the rehearsal input", () => {
  const from = workflow.indexOf("      - name: Package\n");
  const env = workflow.slice(from, workflow.indexOf("        run: |", from));
  expect(env).toContain("          REHEARSAL: ${{ inputs.rehearsal }}\n");
});
