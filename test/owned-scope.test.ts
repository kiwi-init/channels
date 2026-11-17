import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { running } from "../scripts/ci-owned.ts";
import { spawnOwned } from "./owned.ts";

const dir = mkdtempSync(join(tmpdir(), "kiwi-owned-scope-"));
const ORPHANER = `const c = Bun.spawn(["sleep", "300"], { detached: true, stdio: ["ignore", "ignore", "ignore"] }); c.unref(); require("node:fs").writeFileSync(process.argv.at(-1), String(c.pid)); process.exit(0);`;
const left: { fromFile: number; orphans: number[] } = { fromFile: 0, orphans: [] };

beforeAll(() => {
  left.fromFile = spawnOwned(["sleep", "300"]).pid;
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function orphan(name: string, env?: Record<string, string | undefined>): Promise<number> {
  const file = join(dir, name);
  const parent = spawnOwned([process.execPath, "-e", ORPHANER, file], env ? { env } : undefined);
  await parent.exited;
  const end = Date.now() + 10_000;
  while (!existsSync(file) && Date.now() < end) await Bun.sleep(20);
  return Number(readFileSync(file, "utf8"));
}

test("a test whose child leaves a detached grandchild behind and exits, with the environment passed on or inherited", async () => {
  left.orphans = [await orphan("inherited"), await orphan("passed", { ...process.env, EXTRA: "1" })];
  expect(left.orphans.map(running)).toEqual([true, true]);
});

test("those orphans are gone before the next test starts, and the process beforeAll started is still running", () => {
  expect(left.orphans.length).toBe(2);
  expect(left.orphans.map(running)).toEqual([false, false]);
  expect(running(left.fromFile)).toBe(true);
});
