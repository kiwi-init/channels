import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pidIn } from "./owned.ts";

const dir = mkdtempSync(join(tmpdir(), "kiwi-pid-in-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("a pid file that exists but is still empty is waited on, and the pid written into it is the one read", async () => {
  const file = join(dir, "late");
  writeFileSync(file, "");
  setTimeout(() => writeFileSync(file, "4242"), 300);
  expect(await pidIn(file, 5_000)).toBe(4242);
});

test("a pid file that stays empty past the deadline fails, naming the file, instead of reading as pid 0", async () => {
  const file = join(dir, "empty");
  writeFileSync(file, "");
  await expect(pidIn(file, 200)).rejects.toThrow(`no pid in ${file} after 200 ms`);
});
