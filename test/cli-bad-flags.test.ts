import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kiwiCmd } from "./owner.ts";

const home = mkdtempSync(join(tmpdir(), "kiwi-bad-flags-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

async function run(args: string[]) {
  const p = Bun.spawn(kiwiCmd(args), { cwd: home, env: { ...process.env, KIWI_HOME: home }, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

test("an unknown flag is one line on stderr and exit 2, not a crash with a stack (T1894)", async () => {
  const r = await run(["task", "done", "T1", "--pr", "5"]);
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
  expect(r.err).toBe("kiwi: unknown option --pr; `kiwi help task` lists the options\n");
});

test("a flag missing its value is one line too (T1894)", async () => {
  const r = await run(["status", "-c"]);
  expect(r.code).toBe(2);
  expect(r.err.trim().split("\n")).toHaveLength(1);
  expect(r.err).toContain("--channel <value>' argument missing");
});
