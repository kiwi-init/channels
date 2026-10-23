import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { driverAsk, driverSocketProblem, pageAnswer, pageScript, type DriverAnswer } from "../desktop/src/eb-driver.ts";
import { testHomeProblem } from "../desktop/src/eb-test-home.ts";

async function inPage(id: number, fn: string, arg: unknown): Promise<DriverAnswer | null> {
  const posted: string[] = [];
  const window = { __electrobunHostBridge: { postMessage: (m: string) => void posted.push(m) } };
  new Function("window", pageScript(id, fn, JSON.stringify(arg)))(window);
  for (let i = 0; i < 20 && !posted.length; i++) await new Promise((r) => setTimeout(r, 1));
  return posted.length === 1 ? pageAnswer(JSON.parse(posted[0]!)) : null;
}

describe("the Electrobun test driver runs a function in the page and hands back its answer (T442)", () => {
  test("a request is a line of JSON with a numeric id, the function's source and its argument as JSON", () => {
    expect(driverAsk(JSON.stringify({ id: 3, fn: "() => 1", arg: "null" }))).toEqual({ id: 3, fn: "() => 1", arg: "null" });
    expect(driverAsk("not json")).toBeNull();
    expect(driverAsk(JSON.stringify({ id: "3", fn: "() => 1", arg: "null" }))).toBeNull();
    expect(driverAsk(JSON.stringify({ id: 3, fn: () => 1, arg: "null" }))).toBeNull();
    expect(driverAsk(JSON.stringify([3, "() => 1", "null"]))).toBeNull();
  });

  test("the page posts the function's value, under the driver's own id, with undefined as null", async () => {
    expect(await inPage(7, "(a) => a.x * 2", { x: 21 })).toEqual({ id: 7, ok: true, value: 42 });
    expect(await inPage(8, "() => undefined", null)).toEqual({ id: 8, ok: true, value: null });
    expect(await inPage(9, "async (s) => s + '!'", "done")).toEqual({ id: 9, ok: true, value: "done!" });
  });

  test("a function that throws, at once or later, answers with its error instead of leaving the caller waiting", async () => {
    const thrown = await inPage(10, "() => { throw new Error('no such button') }", null);
    expect(thrown?.ok).toBe(false);
    expect(thrown?.ok === false && thrown.error).toContain("no such button");
    const rejected = await inPage(11, "async () => { throw new Error('later') }", null);
    expect(rejected?.ok === false && rejected.error).toContain("later");
  });

  test("an argument with quotes, backslashes and line breaks reaches the page whole", async () => {
    const tricky = `a "quote", a \\ backslash,\na line break and </script>`;
    expect(await inPage(12, "(s) => s", tricky)).toEqual({ id: 12, ok: true, value: tricky });
  });

  test("messages of the app's own RPC aren't the driver's: they go on to its handler", () => {
    expect(pageAnswer({ type: "request", id: 1, method: "relayUrl" })).toBeNull();
    expect(pageAnswer({ type: "response", id: 1, success: true, payload: "x" })).toBeNull();
    expect(pageAnswer({ kiwiDriver: "1", ok: true })).toBeNull();
    expect(pageAnswer(null)).toBeNull();
  });
});

const root = mkdtempSync(join(tmpdir(), "kiwi-eb-driver-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("where the test driver listens (T1820)", () => {
  test("only in a folder only this user can open, and never over a file that isn't a socket", () => {
    const own = join(root, "own");
    mkdirSync(own, { mode: 0o700 });
    chmodSync(own, 0o700);
    expect(driverSocketProblem(join(own, "driver.sock"))).toBeNull();
    const shared = join(root, "shared");
    mkdirSync(shared);
    chmodSync(shared, 0o755);
    expect(driverSocketProblem(join(shared, "driver.sock"))).toContain("isn't a folder only this user can open");
    writeFileSync(join(own, "notes.txt"), "keep me");
    expect(driverSocketProblem(join(own, "notes.txt"))).toContain("isn't a socket, so the driver won't remove it");
    expect(driverSocketProblem(join(root, "missing", "driver.sock"))).toContain("doesn't exist");
    expect(driverSocketProblem("driver.sock")).toContain("isn't an absolute path");
    expect(driverSocketProblem(join(own, "driver.sock"), -2)).toContain("isn't a folder only this user can open");
  });
});

describe("a test build's home (T1820)", () => {
  test("its data folder has to sit under the temp home it was given, or it doesn't start", () => {
    expect(testHomeProblem("/tmp/run/home/Library/Application Support/com.kiwiinit.channels.test/dev", "/tmp/run/home")).toBeNull();
    expect(testHomeProblem("/Users/someone/Library/Application Support/com.kiwiinit.channels.test/dev", "/tmp/run/home")).toContain("Bun follows HOME");
    expect(testHomeProblem("/tmp/run/homework/Library/Application Support/x", "/tmp/run/home")).toContain("isn't under the temp home");
    expect(testHomeProblem("/tmp/run/home", "/tmp/run/home")).toContain("isn't under the temp home");
    expect(testHomeProblem("/tmp/run/home/Library", undefined)).toContain("CFFIXED_USER_HOME");
    expect(testHomeProblem("/tmp/run/home/Library", "relative/home")).toContain("CFFIXED_USER_HOME");
  });
});
