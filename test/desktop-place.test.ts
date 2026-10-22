import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { place } from "../desktop/src/cli.ts";

const dir = mkdtempSync(join(tmpdir(), "kiwi-desktop-place-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const bundled = join(dir, "kiwi-bundled");
writeFileSync(bundled, `#!/bin/sh\necho 1.2.3\n${"# padding\n".repeat(200_000)}`);
chmodSync(bundled, 0o755);

test("places of one binary started at once share one write, and what lands runs", async () => {
  const dest = join(dir, "bin", "kiwi");
  await Promise.all([place(bundled, dest), place(bundled, dest), place(bundled, dest)]);
  const run = Bun.spawnSync([dest], { stdout: "pipe" });
  expect(run.exitCode).toBe(0);
  expect(run.stdout.toString().trim()).toBe("1.2.3");
  expect(readdirSync(join(dir, "bin"))).toEqual(["kiwi"]);
});

test("a later place writes again, over the binary already there", async () => {
  const dest = join(dir, "again", "kiwi");
  await place(bundled, dest);
  rmSync(dest);
  await place(bundled, dest);
  expect(existsSync(dest)).toBe(true);
});
