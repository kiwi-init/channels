import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPTS = join(import.meta.dir, "..", "scripts");
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function project(tests: Record<string, string>, flows: Record<string, string[]>): string {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-ci-tests-"));
  dirs.push(dir);
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "test"));
  for (const f of ["ci-tests.ts", "ci-shards.ts"]) copyFileSync(join(SCRIPTS, f), join(dir, "scripts", f));
  writeFileSync(join(dir, "scripts", "ci-flows.ts"), `export const FLOWS: Record<string, string[]> = ${JSON.stringify(flows)};\n`);
  for (const [name, body] of Object.entries(tests)) writeFileSync(join(dir, "test", `${name}.test.ts`), `import { expect, test } from "bun:test";\n${body}\n`);
  return dir;
}

async function run(dir: string, ...args: string[]): Promise<{ code: number; err: string; ms: number }> {
  const started = Date.now();
  const proc = Bun.spawn(["bun", "scripts/ci-tests.ts", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  return { code, err, ms: Date.now() - started };
}

const passing = `test("adds", () => expect(1 + 1).toBe(2));`;

describe("scripts/ci-tests.ts", () => {
  test("a group whose files all run passes", async () => {
    const r = await run(project({ a: passing, b: passing }, { slow: ["b"] }), "all");
    expect(r.err).toContain("across 2 files");
    expect(r.code).toBe(0);
  }, 30_000);

  test("shards run every file once between them, and each checks the files it was dealt", async () => {
    const dir = project({ a: passing, b: passing, c: passing, d: passing, e: passing }, { slow: [] });
    writeFileSync(
      join(dir, "test", "timings.json"),
      JSON.stringify({ version: 1, files: { "test/a.test.ts": 9000, "test/b.test.ts": 1000, "test/c.test.ts": 1000, "test/d.test.ts": 1000, "test/e.test.ts": 1000 } }),
    );
    const [one, two] = [await run(dir, "all", "--shard=1/2"), await run(dir, "all", "--shard=2/2")];
    expect([one.code, two.code]).toEqual([0, 0]);
    expect(one.err).toContain("across 1 file.");
    expect(two.err).toContain("across 4 files.");
    expect((await run(dir, "all", "--shard=3/2")).code).toBe(2);
    expect((await run(dir, "all", "--shards=1/2")).code).toBe(2);
  }, 30_000);

  test("a test that ends the run with exit 0 fails the group: it didn't run every file", async () => {
    const r = await run(project({ exits: `test("leaves", () => process.exit(0));`, a: passing }, { slow: ["exits"] }), "slow");
    expect(r.err).toContain("a test ended the run early");
    expect(r.code).toBe(1);
  }, 30_000);

  test("a process a test leaves running with the run's stderr doesn't hold the group after bun test exits", async () => {
    const leaves = `test("leaves a sleeper", async () => {
  const sleeper = Bun.spawn(["sleep", "15"], { stdout: "ignore", stderr: "inherit", detached: true });
  sleeper.unref();
  await Bun.write("sleeper.pid", String(sleeper.pid));
});`;
    const dir = project({ leaves, a: passing }, { slow: ["leaves"] });
    const r = await run(dir, "slow");
    process.kill(Number(await Bun.file(join(dir, "sleeper.pid")).text()), "SIGKILL");
    expect(r.code).toBe(0);
    expect(r.ms).toBeLessThan(8_000);
  }, 30_000);

  test("the file count comes from the last summary, so a test printing one of its own can't stand in for it", async () => {
    const prints = `test("prints a summary", () => console.error("Ran 9 tests across 9 files."));`;
    const r = await run(project({ prints, a: passing }, { slow: ["prints"] }), "all");
    expect(r.code).toBe(0);
  }, 30_000);
});
