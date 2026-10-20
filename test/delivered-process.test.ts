import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliveredInProcess, deliveredUpTo, noteDelivered } from "../src/hooks/delivered.ts";

let dir = "";
let was: string | undefined;
beforeEach(() => {
  was = process.env.KIWI_HOME;
  dir = mkdtempSync(join(tmpdir(), "kiwi-delivered-"));
  process.env.KIWI_HOME = dir;
});
afterEach(() => {
  if (was === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = was;
  rmSync(dir, { recursive: true, force: true });
});

test("a session counts what earlier sessions of its own process were handed, never another process's or another seat's", () => {
  noteDelivered("ch", "ana", "before-clear", 7, 4242);
  noteDelivered("ch", "ana", "other-process", 9, 5151);
  noteDelivered("ch", "ana.b", "x", 11, 4242);
  noteDelivered("ch", "anab", "y", 12, 4242);
  expect(deliveredInProcess("ch", "ana", "after-clear", 4242)).toBe(7);
  expect(deliveredInProcess("ch", "ana", "after-clear", 5151)).toBe(9);
  expect(deliveredInProcess("ch", "ana", "after-clear", 6000)).toBe(0);
  expect(deliveredInProcess("ch", "ana", "after-clear")).toBe(0);
  expect(deliveredInProcess("ch", "ana", "other-process", 4242)).toBe(9);
});

test("a record from before the process was noted still counts for its own session, and only there", () => {
  mkdirSync(join(dir, "listen-hooks"), { recursive: true });
  writeFileSync(join(dir, "listen-hooks", "ch.ana.old.delivered"), "5");
  expect(deliveredUpTo("ch", "ana", "old")).toBe(5);
  expect(deliveredInProcess("ch", "ana", "old", 4242)).toBe(5);
  expect(deliveredInProcess("ch", "ana", "new", 4242)).toBe(0);
  noteDelivered("ch", "ana", "old", 3, 4242);
  expect(deliveredUpTo("ch", "ana", "old")).toBe(5);
  expect(deliveredInProcess("ch", "ana", "new", 4242)).toBe(5);
});

test("a seat whose names share dots with another's never takes that seat's record, and a dotted session id still counts", () => {
  noteDelivered("ch.a", "b", "s1", 77, 4242);
  expect(deliveredInProcess("ch", "a.b", "s2", 4242)).toBe(0);
  expect(deliveredInProcess("ch.a", "b", "s2", 4242)).toBe(77);
  noteDelivered("ch", "ana", "old.session", 7, 4242);
  noteDelivered("ch", "ana", "b.old", 8, 4242);
  expect(deliveredInProcess("ch", "ana", "new.session", 4242)).toBe(8);
  expect(deliveredInProcess("ch", "ana.b", "new", 4242)).toBe(0);
});

test("a record with a channel but no agent is no record, even at the seat's own path", () => {
  mkdirSync(join(dir, "listen-hooks"), { recursive: true });
  writeFileSync(join(dir, "listen-hooks", "ch.a.b.same.delivered"), "77 4242 ch.a");
  expect(deliveredUpTo("ch", "a.b", "same")).toBe(0);
  expect(deliveredInProcess("ch", "a.b", "same", 4242)).toBe(0);
  writeFileSync(join(dir, "listen-hooks", "ch.a.b.same.delivered"), "77 4242 ch a.b extra");
  expect(deliveredInProcess("ch", "a.b", "same", 4242)).toBe(0);
  writeFileSync(join(dir, "listen-hooks", "ch.a.b.same.delivered"), "77 4242");
  expect(deliveredInProcess("ch", "a.b", "same", 4242)).toBe(77);
  expect(deliveredInProcess("ch", "a.b", "other", 4242)).toBe(0);
});
