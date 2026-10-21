import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
