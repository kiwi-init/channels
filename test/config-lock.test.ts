import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withLock } from "../src/config/file.ts";

function scratch(): { dir: string; lock: string } {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-config-lock-"));
  return { dir, lock: join(dir, "config.lock") };
}

const DEAD_PID = 2 ** 22 + 4242;

test("a lock left by a process that's gone is taken at once, not after waiting", () => {
  const { dir, lock } = scratch();
  try {
    mkdirSync(lock);
    writeFileSync(join(lock, "owner"), `${DEAD_PID}:left-behind`);
    const t0 = performance.now();
    expect(withLock(lock, () => "ran")).toBe("ran");
    expect(performance.now() - t0).toBeLessThan(500);
    expect(existsSync(lock)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a lock a live process holds is waited for, not stolen", () => {
  const { dir, lock } = scratch();
  const holder = Bun.spawn(["sleep", "30"]);
  try {
    mkdirSync(lock);
    writeFileSync(join(lock, "owner"), `${holder.pid}:holding`);
    expect(() => withLock(lock, () => "ran", 300)).toThrow("couldn't lock");
    expect(readFileSync(join(lock, "owner"), "utf8")).toBe(`${holder.pid}:holding`);
  } finally {
    holder.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a holder whose lock was taken over leaves the new holder's lock in place", () => {
  const { dir, lock } = scratch();
  try {
    withLock(lock, () => {
      rmSync(lock, { recursive: true, force: true });
      mkdirSync(lock);
      writeFileSync(join(lock, "owner"), `${process.pid}:someone-else`);
    });
    expect(readFileSync(join(lock, "owner"), "utf8")).toBe(`${process.pid}:someone-else`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
