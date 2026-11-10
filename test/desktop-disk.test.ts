import { afterAll, expect, test } from "bun:test";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { daemonLogPath, LOG_KEEP_BYTES, trimDaemonLog } from "../desktop/src/daemon-client.ts";
import { useHost } from "../desktop/src/host.ts";
import { logMainError, MAIN_LOG_KEEP_BYTES } from "../desktop/src/main-log.ts";
import { readIndexFile } from "../desktop/src/search-store.ts";
import { fakeHost } from "./fake-host.ts";

const root = mkdtempSync(join(tmpdir(), "kiwi-disk-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("main.log starts over once it passes 1 MB, keeping the one before as main.log.1 (T1780)", () => {
  const logs = join(root, "logs");
  useHost(fakeHost({ paths: { logs } }).host);
  logMainError(new Error("first"));
  const file = join(logs, "main.log");
  expect(readFileSync(file, "utf8")).toContain("first");
  expect(existsSync(`${file}.1`)).toBe(false);
  writeFileSync(file, "x".repeat(MAIN_LOG_KEEP_BYTES + 1));
  logMainError(new Error("second"));
  expect(statSync(`${file}.1`).size).toBe(MAIN_LOG_KEEP_BYTES + 1);
  expect(readFileSync(file, "utf8")).toContain("second");
  expect(statSync(file).size).toBeLessThan(10_000);
  writeFileSync(file, "y".repeat(MAIN_LOG_KEEP_BYTES + 1));
  logMainError(new Error("third"));
  expect(readFileSync(`${file}.1`, "utf8").startsWith("y")).toBe(true);
  expect(readdirSync(logs).sort()).toEqual(["main.log", "main.log.1"]);
});

test("daemon.log past 1 MB is copied to daemon.log.1 and emptied in place, so a daemon holding it open keeps writing to the same file (T1780)", () => {
  const home = join(root, "home");
  mkdirSync(home);
  const file = daemonLogPath(home);
  writeFileSync(file, "small\n");
  trimDaemonLog(home);
  expect(readFileSync(file, "utf8")).toBe("small\n");
  expect(existsSync(`${file}.1`)).toBe(false);
  const held = openSync(file, "a");
  try {
    writeSync(held, "z".repeat(LOG_KEEP_BYTES + 1));
    trimDaemonLog(home);
    expect(statSync(`${file}.1`).size).toBe(LOG_KEEP_BYTES + 7);
    expect(statSync(file).size).toBe(0);
    writeSync(held, "after the trim\n");
    expect(readFileSync(file, "utf8")).toBe("after the trim\n");
  } finally {
    closeSync(held);
  }
  trimDaemonLog(join(root, "no-such-home"));
});

test("a search index save cut short by a quit leaves <file>.<pid>.tmp behind: the next open of that index clears other runs' leftovers and nothing else (T1780)", async () => {
  const dir = join(root, "search");
  mkdirSync(dir);
  const file = join(dir, "room-1.idx");
  const mine = `${file}.${process.pid}.tmp`;
  for (const f of [`${file}.999999.tmp`, `${file}.4242.tmp`, mine, join(dir, "room-2.idx.4242.tmp"), join(dir, "room-1.idx.notes.tmp"), join(dir, "room-1.idx.4242.tmp.bak")])
    writeFileSync(f, "half a save");
  expect(await readIndexFile(file, "k", "room-1")).toBeNull();
  expect(readdirSync(dir).sort()).toEqual([`room-1.idx.${process.pid}.tmp`, "room-1.idx.4242.tmp.bak", "room-1.idx.notes.tmp", "room-2.idx.4242.tmp"].sort());
});
