import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const fixtures = join(root, "packages/core/type-fixtures/readonly-state");
const WRITABLE = "draft-writes.ts";

const compiled = spawnSync(join(root, "node_modules/.bin/tsrs"), ["--noEmit", "-p", join(fixtures, "tsconfig.json")], { cwd: root, encoding: "utf8" });
const errors = `${compiled.stdout}${compiled.stderr}`.split("\n").flatMap((line) => {
  const hit = /readonly-state\/([\w-]+\.ts)\(\d+,\d+\): error (TS\d+)/.exec(line);
  return hit?.[1] && hit[2] ? [{ file: hit[1], code: hit[2] }] : [];
});
const files = readdirSync(fixtures).filter((f) => f.endsWith(".ts"));

test("every write through a value read from ChannelState fails to compile as a read-only assignment", () => {
  const refused = files.filter((f) => f !== WRITABLE);
  expect(refused.length).toBeGreaterThan(0);
  for (const file of refused) expect(errors.filter((e) => e.file === file).map((e) => e.code)).toEqual(["TS2540"]);
});

test("the fold's draft keeps its writes through the same selectors", () => {
  expect(files).toContain(WRITABLE);
  expect(errors.filter((e) => e.file === WRITABLE)).toEqual([]);
});
