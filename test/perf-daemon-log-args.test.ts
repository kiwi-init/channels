import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { benchArgs, claimWork } from "../scripts/perf-daemon-log-args.ts";
import { spawnOwned } from "./owned.ts";

const scratch = mkdtempSync(join(tmpdir(), "kiwi-perf-args-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SCRIPT = resolve(import.meta.dir, "../scripts/perf-daemon-log.ts");

test("the workload refuses a missing or empty --work instead of picking a path", () => {
  expect(benchArgs(["bun", SCRIPT])).toEqual({ why: expect.stringContaining("--work DIR is required") });
  expect(benchArgs(["bun", SCRIPT, "--work"])).toEqual({ why: "--work needs a directory after it" });
  expect(benchArgs(["bun", SCRIPT, "--work", ""])).toEqual({ why: "--work needs a directory after it" });
  expect(benchArgs(["bun", SCRIPT, "--work", "--seats", "3"])).toEqual({ why: "--work needs a directory after it" });
  expect(benchArgs(["bun", SCRIPT, "--work", "x", "--seats"])).toEqual({ why: "--seats needs a number after it" });
  expect(benchArgs(["bun", SCRIPT, "--work", "x", "--seats", "0"])).toEqual({ why: expect.stringContaining("--seats must be a whole number") });
  expect(benchArgs(["bun", SCRIPT, "--work", "x", "--seats", "3"])).toMatchObject({ work: resolve("x"), seats: 3, perCycle: 300 });
});

test("an existing directory is refused and keeps what is in it", () => {
  const theirs = join(scratch, "theirs");
  mkdirSync(theirs);
  writeFileSync(join(theirs, "sentinel"), "keep me");
  expect(claimWork(theirs)).toContain("already exists");
  expect(readFileSync(join(theirs, "sentinel"), "utf8")).toBe("keep me");
});

test("the script itself stops before touching the disk on bad arguments, and an existing --work survives a run attempt", async () => {
  const theirs = join(scratch, "run-theirs");
  mkdirSync(theirs);
  writeFileSync(join(theirs, "sentinel"), "keep me");
  const run = async (args: string[]) => {
    const p = spawnOwned(["bun", SCRIPT, ...args], { cwd: scratch, stdout: "pipe", stderr: "pipe" });
    return { code: await p.exited, err: await new Response(p.stderr).text() };
  };
  expect(await run([])).toMatchObject({ code: 2, err: expect.stringContaining("--work DIR is required") });
  expect(await run(["--work"])).toMatchObject({ code: 2, err: expect.stringContaining("--work needs a directory") });
  expect(await run(["--work", theirs])).toMatchObject({ code: 2, err: expect.stringContaining("already exists") });
  expect(readFileSync(join(theirs, "sentinel"), "utf8")).toBe("keep me");
  expect(existsSync(join(theirs, "home"))).toBe(false);
  const fresh = join(scratch, "fresh");
  expect(claimWork(fresh)).toBeNull();
  expect(existsSync(fresh)).toBe(true);
});
