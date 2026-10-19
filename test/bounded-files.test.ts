import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRotated } from "../src/daemon/wake.ts";
import { pruneHookFiles } from "../src/hooks/delivered.ts";

test("the wake log starts over past its size, keeping one older file", () => {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-bounded-log-"));
  try {
    const log = join(dir, "wake.log");
    for (let i = 0; i < 30; i++) appendRotated(log, `line ${i} ${"x".repeat(40)}\n`, 500);
    const now = readFileSync(log, "utf8");
    const older = readFileSync(`${log}.1`, "utf8");
    expect(now.length).toBeLessThanOrEqual(500 + 60);
    expect(older.length).toBeLessThanOrEqual(500 + 60);
    expect(now).toContain("line 29 ");
    expect(existsSync(`${log}.2`)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hook bookkeeping older than a week goes, newer stays", () => {
  const home = mkdtempSync(join(tmpdir(), "kiwi-bounded-hooks-"));
  try {
    const week = 7 * 24 * 3600_000;
    mkdirSync(join(home, "listen-hooks"));
    mkdirSync(join(home, "hook-state"));
    const files = {
      oldHeard: join(home, "listen-hooks", "old-session.heard"),
      newHeard: join(home, "listen-hooks", "new-session.heard"),
      oldDelivered: join(home, "listen-hooks", "ch.agent.old.delivered"),
      oldState: join(home, "hook-state", "old-session.prompt"),
      newState: join(home, "hook-state", "new-session.prompt"),
    };
    for (const f of Object.values(files)) writeFileSync(f, "x");
    const longAgo = new Date(Date.now() - week - 3600_000);
    for (const f of [files.oldHeard, files.oldDelivered, files.oldState]) utimesSync(f, longAgo, longAgo);
    expect(pruneHookFiles(home, week)).toBe(3);
    expect(Object.fromEntries(Object.entries(files).map(([k, f]) => [k, existsSync(f)]))).toEqual({ oldHeard: false, newHeard: true, oldDelivered: false, oldState: false, newState: true });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
