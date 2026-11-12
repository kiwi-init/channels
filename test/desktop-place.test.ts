import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { place } from "../desktop/src/cli.ts";

const dir = mkdtempSync(join(tmpdir(), "kiwi-desktop-place-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const bundled = join(dir, "kiwi-bundled");
writeFileSync(bundled, `#!/bin/sh\necho 1.2.3\n${"# padding\n".repeat(200_000)}`);
chmodSync(bundled, 0o755);

test("places of one binary started at once share one write, and what lands runs", async () => {
  const dest = join(dir, "bin", "kiwi");
  await Promise.all([place(bundled, dest), place(bundled, dest), place(bundled, dest)]);
  const run = Bun.spawnSync([dest], { stdout: "pipe" });
  expect(run.exitCode).toBe(0);
  expect(run.stdout.toString().trim()).toBe("1.2.3");
  expect(readdirSync(join(dir, "bin"))).toEqual(["kiwi"]);
});

interface Quit {
  started: number;
  outcome: string;
  again: string;
  alive: number;
  left: string[];
  files: string[];
}

function quitDuring(name: string, bundle: string, until: "started" | "written"): Quit {
  const dest = join(dir, name, "kiwi");
  mkdirSync(join(dir, name));
  const ran = Bun.spawnSync([process.execPath, join(import.meta.dir, "fixtures", "place-quit.ts"), bundle, dest, until], { stdout: "pipe", stderr: "pipe" });
  expect(ran.exitCode, ran.stderr.toString()).toBe(0);
  return JSON.parse(ran.stdout.toString()) as Quit;
}

test("quitting ends a build under way: its process is killed, nothing half-made stays, and no new build starts", () => {
  const bundle = join(dir, "building.js");
  writeFileSync(bundle, `console.log("1.2.3");\n${"globalThis.pad = (globalThis.pad ?? 0) + 1;\n".repeat(200_000)}`);
  const told = quitDuring("quit-building", bundle, "started");
  expect(told.started).toBeGreaterThan(0);
  expect(told.outcome).toContain("the kiwi CLI didn't build");
  expect(told.again).toContain("Channels is quitting");
  expect(told.alive).toBe(0);
  expect(told.files).toEqual([]);
});

test("quitting while the built CLI is still being checked removes the half-made file at once, before the app is gone", () => {
  const bundle = join(dir, "checking.js");
  writeFileSync(bundle, 'if (process.argv.includes("--version")) Bun.sleepSync(20_000);\nconsole.log("1.2.3");\n');
  const told = quitDuring("quit-checking", bundle, "written");
  expect(told.started).toBeGreaterThan(0);
  expect(told.left).toEqual([]);
  expect(told.outcome).not.toBe("placed");
  expect(told.alive).toBe(0);
  expect(told.files).toEqual([]);
});

test("a later place writes again, over the binary already there", async () => {
  const dest = join(dir, "again", "kiwi");
  await place(bundled, dest);
  rmSync(dest);
  await place(bundled, dest);
  expect(existsSync(dest)).toBe(true);
});
