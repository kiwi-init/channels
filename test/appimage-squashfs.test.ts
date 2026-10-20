import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "kiwi-appimage-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function appImage(name: string, compressor: number, block: number): string {
  const dir = join(root, name);
  mkdirSync(dir);
  const shoff = 4096;
  const elf = Buffer.alloc(shoff + 3 * 64);
  elf.writeUInt32BE(0x7f454c46, 0);
  elf[4] = 2;
  elf.writeBigUInt64LE(BigInt(shoff), 0x28);
  elf.writeUInt16LE(64, 0x3a);
  elf.writeUInt16LE(3, 0x3c);
  const sb = Buffer.alloc(96);
  sb.write("hsqs", 0, "latin1");
  sb.writeUInt32LE(block, 12);
  sb.writeUInt16LE(compressor, 20);
  writeFileSync(join(dir, "Channels-0.20.6-linux-x86_64.AppImage"), Buffer.concat([elf, sb]));
  return dir;
}

const check = (dir: string) => {
  const r = Bun.spawnSync(["bun", "desktop/scripts/appimage-squashfs.ts", dir]);
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};

test("an AppImage packed with gzip in 128 KiB blocks passes", () => {
  const r = check(appImage("gzip", 1, 128 * 1024));
  expect(r.code).toBe(0);
  expect(r.out).toContain("gzip, 128 KiB blocks");
});

test("an AppImage packed with xz in 1 MiB blocks, electron-builder's maximum, fails the release build", () => {
  const r = check(appImage("xz", 4, 1024 * 1024));
  expect(r.code).toBe(1);
  expect(r.out).toContain("xz, 1024 KiB blocks");
});

test("a fast compressor in blocks over 128 KiB still fails", () => {
  expect(check(appImage("big-zstd", 6, 1024 * 1024)).code).toBe(1);
});

test("a release folder without an AppImage, or a file that is not one, fails instead of passing", () => {
  mkdirSync(join(root, "empty"));
  expect(check(join(root, "empty")).code).toBe(1);
  mkdirSync(join(root, "junk"));
  writeFileSync(join(root, "junk", "Channels.AppImage"), "not an elf");
  expect(check(join(root, "junk")).code).toBe(1);
});
