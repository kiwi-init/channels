import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeDmg } from "../desktop/scripts/eb-dmg.ts";

const BUSY = { code: 1, stdout: "", stderr: "hdiutil: create failed - Resource busy\n" };

function fake(codes: (number | "silent")[]) {
  const calls: string[][] = [];
  const pauses: number[] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    const code = codes[calls.length - 1] ?? 0;
    if (code === "silent") return { code: 0, stdout: "", stderr: "" };
    if (code !== 0) return BUSY;
    writeFileSync(args.at(-1) ?? "", "dmg");
    return { code, stdout: "created", stderr: "" };
  };
  return { run, calls, pauses, pause: (ms: number) => void pauses.push(ms) };
}

const dir = () => mkdtempSync(join(tmpdir(), "eb-dmg-"));

test("a dmg that hdiutil makes on the first try is made once, with no pause", () => {
  const d = dir();
  const f = fake([0]);
  makeDmg(join(d, "stage"), join(d, "Channels.dmg"), f.run, f.pause);
  expect(f.calls).toEqual([["hdiutil", "create", "-volname", "Channels", "-srcfolder", join(d, "stage"), "-format", "ULMO", "-o", join(d, "Channels.dmg")]]);
  expect(f.pauses).toEqual([]);
  rmSync(d, { recursive: true, force: true });
});

test("hdiutil failing on a macOS runner is tried again, up to three times, 10 s apart (T886)", () => {
  const d = dir();
  const f = fake([1, 1, 0]);
  makeDmg(join(d, "stage"), join(d, "Channels.dmg"), f.run, f.pause);
  expect(f.calls.length).toBe(3);
  expect(f.pauses).toEqual([10_000, 10_000]);
  rmSync(d, { recursive: true, force: true });
});

test("three failures fail the release with hdiutil's own words, not a bare exit code", () => {
  const d = dir();
  const f = fake([1, 1, 1]);
  expect(() => makeDmg(join(d, "stage"), join(d, "Channels.dmg"), f.run, f.pause)).toThrow("making the dmg failed 3 times (hdiutil exited 1: hdiutil: create failed - Resource busy)");
  expect(f.calls.length).toBe(3);
  rmSync(d, { recursive: true, force: true });
});

test("hdiutil exiting 0 without leaving a dmg is a failure, tried again, and said so (T928)", () => {
  const d = dir();
  const dmg = join(d, "Channels.dmg");
  const once = fake(["silent", 0]);
  makeDmg(join(d, "stage"), dmg, once.run, once.pause);
  expect(once.calls.length).toBe(2);
  const never = fake(["silent", "silent", "silent"]);
  expect(() => makeDmg(join(d, "stage"), dmg, never.run, never.pause)).toThrow(`making the dmg failed 3 times (hdiutil exited 0 but left no ${dmg}: no output)`);
  rmSync(d, { recursive: true, force: true });
});
