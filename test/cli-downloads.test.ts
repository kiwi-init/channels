import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "scripts", "cli-downloads.ts");
const TARGETS = ["kiwi-darwin-arm64", "kiwi-darwin-x64", "kiwi-linux-x64", "kiwi-linux-arm64", "kiwi-windows-x64.exe"];

function release(sizes: Record<string, number>): string {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-cli-downloads-"));
  for (const [name, bytes] of Object.entries(sizes)) {
    writeFileSync(join(dir, name), "");
    truncateSync(join(dir, name), bytes);
  }
  return dir;
}

function check(dir: string) {
  const r = Bun.spawnSync([process.execPath, SCRIPT, dir], { stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

const raw = Object.fromEntries(TARGETS.map((t) => [t, 80_000_000]));

test("every CLI download within 30 MB, counting the smaller of .xz and .gz, passes", () => {
  const dir = release({
    ...raw,
    ...Object.fromEntries(
      TARGETS.flatMap((t) => [
        [`${t}.gz`, 35_000_000],
        [`${t}.xz`, 28_000_000],
      ]),
    ),
  });
  try {
    const r = check(dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain("kiwi-linux-x64.xz: 28.0 MB (from 80.0 MB)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a download over 30 MB, or a binary with no compressed download, fails", () => {
  const over = release({ ...raw, ...Object.fromEntries(TARGETS.map((t) => [`${t}.gz`, t === "kiwi-linux-arm64" ? 31_000_000 : 20_000_000])) });
  const missing = release({ ...raw, ...Object.fromEntries(TARGETS.filter((t) => t !== "kiwi-darwin-x64").map((t) => [`${t}.gz`, 20_000_000])) });
  try {
    const a = check(over);
    expect(a.code).toBe(1);
    expect(a.out).toContain("kiwi-linux-arm64.gz: 31.0 MB (from 80.0 MB), over the 30.0 MB budget");
    const b = check(missing);
    expect(b.code).toBe(1);
    expect(b.out).toContain("kiwi-darwin-x64: no compressed download next to it");
  } finally {
    rmSync(over, { recursive: true, force: true });
    rmSync(missing, { recursive: true, force: true });
  }
});
