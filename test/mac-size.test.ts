import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "kiwi-mac-size-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const MB = 1024 ** 2;

function release(name: string, dmgMB: number, appMB: number): string {
  const dir = join(root, name);
  mkdirSync(join(dir, "mac-arm64", "Channels.app", "Contents"), { recursive: true });
  const file = (p: string, size: number) => {
    writeFileSync(p, "");
    truncateSync(p, size);
  };
  file(join(dir, "Channels-0.20.0-mac-arm64.dmg"), dmgMB * MB);
  file(join(dir, "Channels-0.20.0-mac-arm64.zip"), dmgMB * MB);
  file(join(dir, "mac-arm64", "Channels.app", "Contents", "Electron Framework"), appMB * MB);
  return dir;
}

const size = (dir: string) => {
  const r = Bun.spawnSync(["bun", "desktop/scripts/mac-size.ts", dir]);
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};

test("a Mac release at the 0.20 budget passes: dmg and zip up to 150 MiB, the app up to 320 MiB", () => {
  const r = size(release("under", 145, 300));
  expect(r.code).toBe(0);
  expect(r.out).toContain("at the 0.20 budget");
});

test("a dmg, zip or app over the 0.20 budget fails the release build", () => {
  expect(size(release("big-dmg", 151, 300)).code).toBe(1);
  expect(size(release("big-app", 140, 321)).code).toBe(1);
});

test("a release folder without the Mac app or its dmg fails instead of passing empty", () => {
  mkdirSync(join(root, "empty"));
  expect(size(join(root, "empty")).code).toBe(1);
});
