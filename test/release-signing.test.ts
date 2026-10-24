import { expect, test } from "bun:test";

const run = (rehearsal: string) => Bun.spawnSync(["bun", "desktop/scripts/eb-release.ts", "missing-release-eb", "missing-out"], { env: { PATH: process.env["PATH"] ?? "", REHEARSAL: rehearsal } });

test("a tag release without the Mac signing secrets fails instead of publishing an unsigned app", () => {
  const r = run("false");
  expect(r.exitCode).toBe(1);
  expect(r.stderr.toString()).toContain("can't publish an unsigned Mac app");
});

test("a rehearsal goes on unsigned without the secrets", () => {
  expect(run("true").stderr.toString()).not.toContain("can't publish an unsigned Mac app");
});
