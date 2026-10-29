import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeDmg } from "../desktop/scripts/eb-dmg.ts";

const root = mkdtempSync(join(tmpdir(), "kiwi-eb-dmg-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Outcome = { code: number; writes: boolean; stderr?: string };

function hdiutil(outcomes: Outcome[]): { run: (cmd: string, args: string[]) => { code: number; stdout: string; stderr: string }; calls: () => number } {
  let calls = 0;
  return {
    run: (_cmd, args) => {
      const o = outcomes[Math.min(calls++, outcomes.length - 1)] ?? { code: 1, writes: false };
      if (o.writes) writeFileSync(args[args.length - 1] ?? "", "dmg");
      return { code: o.code, stdout: "", stderr: o.stderr ?? "" };
    },
    calls: () => calls,
  };
}

test("a dmg that hdiutil made on the second try is kept", () => {
  const dmg = join(root, "second.dmg");
  const fake = hdiutil([
    { code: 1, writes: false, stderr: "hdiutil: create failed - Resource busy" },
    { code: 0, writes: true },
  ]);
  const pauses: number[] = [];
  makeDmg(root, dmg, fake.run, (ms) => pauses.push(ms));
  expect(fake.calls()).toBe(2);
  expect(pauses).toEqual([10_000]);
});

test("hdiutil exiting 0 without a dmg counts as a failure and is tried again", () => {
  const dmg = join(root, "silent.dmg");
  const fake = hdiutil([
    { code: 0, writes: false },
    { code: 0, writes: true },
  ]);
  makeDmg(root, dmg, fake.run, () => {});
  expect(fake.calls()).toBe(2);
});

test("after three failures the error carries hdiutil's own words", () => {
  const dmg = join(root, "never.dmg");
  const fake = hdiutil([{ code: 1, writes: false, stderr: "hdiutil: create failed - Resource busy" }]);
  expect(() => makeDmg(root, dmg, fake.run, () => {})).toThrow("making the dmg failed 3 times (hdiutil exited 1: hdiutil: create failed - Resource busy)");
  expect(fake.calls()).toBe(3);
});

test("three silent exits without a dmg say so", () => {
  const dmg = join(root, "ghost.dmg");
  const fake = hdiutil([{ code: 0, writes: false }]);
  expect(() => makeDmg(root, dmg, fake.run, () => {})).toThrow(`hdiutil exited 0 but left no ${dmg}: no output`);
});
