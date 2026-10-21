import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const real = mkdtempSync(join(tmpdir(), "kiwi-real-home-"));
afterAll(() => rmSync(real, { recursive: true, force: true }));

test("a test run gets its own KIWI_HOME and Claude settings even when the shell exports the real ones", () => {
  const p = Bun.spawnSync([process.execPath, "test", "./test/fixtures/home-probe.ts"], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, KIWI_HOME: join(real, "kiwi"), CLAUDE_CONFIG_DIR: join(real, "claude") },
  });
  const line = `${p.stdout.toString()}${p.stderr.toString()}`.split("\n").find((l) => l.startsWith("HOME_PROBE "));
  const seen = JSON.parse(line?.slice("HOME_PROBE ".length) ?? "{}") as { kiwi?: string; claude?: string };
  expect(seen.kiwi).toContain("kiwi-test-harness-");
  expect(seen.claude).toContain("kiwi-test-harness-");
  expect(`${seen.kiwi}${seen.claude}`).not.toContain(real);
});
