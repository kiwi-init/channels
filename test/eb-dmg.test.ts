import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeDmg } from "../desktop/scripts/eb-dmg.ts";

const BUSY = { code: 1, stdout: "", stderr: "hdiutil: create failed - Resource busy\n" };

function fake(codes: number[]) {
  const calls: string[][] = [];
  const pauses: number[] = [];
  const run = (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    const code = codes[calls.length - 1] ?? 0;
    return code === 0 ? { code, stdout: "created", stderr: "" } : BUSY;
  };
  return { run, calls, pauses, pause: (ms: number) => void pauses.push(ms) };
}

const dir = () => mkdtempSync(join(tmpdir(), "eb-dmg-"));

test("a dmg that hdiutil makes on the first try is made once, with no pause", () => {
  const d = dir();
  const f = fake([0]);
  makeDmg(join(d, "stage"), join(d, "Channels.dmg"), f.run, f.pause);
  expect(f.calls).toEqual([["hdiutil", "create", "-volname", "Channels Livewire", "-srcfolder", join(d, "stage"), "-format", "ULMO", "-o", join(d, "Channels.dmg")]]);
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
  expect(() => makeDmg(join(d, "stage"), join(d, "Channels.dmg"), f.run, f.pause)).toThrow("making the dmg failed 3 times (hdiutil exited 1): hdiutil: create failed - Resource busy");
  expect(f.calls.length).toBe(3);
  rmSync(d, { recursive: true, force: true });
});
