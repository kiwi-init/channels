import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holdSession, shownCwd } from "../src/hooks/permission.ts";

const home = mkdtempSync(join(tmpdir(), "kiwi-permission-session-"));
const was = process.env.KIWI_HOME;
beforeAll(() => {
  process.env.KIWI_HOME = home;
});
afterAll(() => {
  if (was === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = was;
  rmSync(home, { recursive: true, force: true });
});

test("the folder shown leaves the home folder's path out", () => {
  expect(shownCwd("/Users/ada/src/app", "/Users/ada")).toBe("~/src/app");
  expect(shownCwd("/Users/ada", "/Users/ada")).toBe("~");
  expect(shownCwd("/Users/adam/src", "/Users/ada")).toBe("/Users/adam/src");
  expect(shownCwd("/srv/app", "/Users/ada")).toBe("/srv/app");
  expect(shownCwd(undefined, "/Users/ada")).toBeUndefined();
});

test("one hook waits per session; a later prompt in it goes to the terminal and tells the waiting hook a newer prompt started", () => {
  const first = holdSession("sess-a")!;
  expect(first.newer()).toBe(false);
  expect(holdSession("sess-a")).toBeNull();
  expect(first.newer()).toBe(true);
  const other = holdSession("sess-b")!;
  expect(other.newer()).toBe(false);
  other.release();
  first.release();
  const again = holdSession("sess-a")!;
  expect(again.newer()).toBe(false);
  again.release();
});

test("a lock file still being written counts as held for a few seconds, then as left behind", () => {
  mkdirSync(join(home, "permission"), { recursive: true });
  const file = join(home, "permission", "sess-c.pid");
  writeFileSync(file, "");
  expect(holdSession("sess-c")).toBeNull();
  const old = new Date(Date.now() - 60_000);
  utimesSync(file, old, old);
  const taken = holdSession("sess-c")!;
  expect(taken).not.toBeNull();
  taken.release();
});

test("a newer-prompt mark from before this hook took the session doesn't count", () => {
  mkdirSync(join(home, "permission"), { recursive: true });
  const marker = join(home, "permission", "sess-d.pid.newer");
  writeFileSync(marker, "x");
  const old = new Date(Date.now() - 60_000);
  utimesSync(marker, old, old);
  const held = holdSession("sess-d")!;
  expect(held.newer()).toBe(false);
  held.release();
});

test("letting go of a session leaves alone a lock another hook holds now, and the newer-prompt mark meant for it", () => {
  const first = holdSession("sess-e")!;
  const file = join(home, "permission", "sess-e.pid");
  writeFileSync(file, "424242");
  writeFileSync(`${file}.newer`, String(Date.now()));
  first.release();
  expect(readFileSync(file, "utf8")).toBe("424242");
  expect(existsSync(`${file}.newer`)).toBe(true);
  rmSync(file);
  rmSync(`${file}.newer`);
  const mine = holdSession("sess-e")!;
  writeFileSync(`${file}.newer`, String(Date.now()));
  mine.release();
  expect(existsSync(file)).toBe(false);
  expect(existsSync(`${file}.newer`)).toBe(false);
});
