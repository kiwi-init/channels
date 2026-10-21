import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holdsInput, leadsTerminal } from "../src/terminals/shared/foreground.ts";
import { listIn, nested, object, objectsIn, parseJson } from "../src/terminals/shared/json.ts";
import { run, runNow } from "../src/terminals/shared/run.ts";
import { tmuxSocket } from "../src/terminals/shared/tmux.ts";

const SAYS = ["sh", "-c", "echo out; echo err >&2; exit 3"];

describe("the one runner for terminal programs", () => {
  test("both forms give the exit status, stdout and stderr", async () => {
    expect(runNow(SAYS)).toEqual({ status: 3, stdout: "out\n", stderr: "err\n" });
    expect(await run(SAYS)).toEqual({ status: 3, stdout: "out\n", stderr: "err\n" });
  });

  test("a program that isn't there has no status and says why", async () => {
    const now = runNow(["/nonexistent/rex", "version"]);
    const later = await run(["/nonexistent/rex", "version"]);
    expect(now.status).toBeNull();
    expect(now.stderr).toContain("ENOENT");
    expect(later.status).toBeNull();
    expect(later.stderr).toContain("ENOENT");
  });

  test("a program that doesn't answer is given up on at its deadline, even when its child holds the output open", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-terminals-run-"));
    const bin = join(dir, "slow");
    writeFileSync(bin, "#!/bin/sh\nsleep 10\n");
    chmodSync(bin, 0o755);
    const started = Date.now();
    expect((await run([bin], 300)).status).toBeNull();
    expect(Date.now() - started).toBeLessThan(3_000);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("the JSON readers", () => {
  test("only a plain object counts as one, and anything that isn't one JSON value reads as nothing", () => {
    expect(object({ a: 1 })).toEqual({ a: 1 });
    expect([object([1]), object(null), object("x")]).toEqual([null, null, null]);
    expect(parseJson('{"a":[1]}')).toEqual({ a: [1] });
    expect([parseJson(""), parseJson("  \n"), parseJson("{")]).toEqual([null, null, null]);
  });

  test("a path is followed through objects only", () => {
    expect(nested({ a: { b: { c: 7 } } }, "a", "b", "c")).toBe(7);
    expect(nested({ a: [{ b: 1 }] }, "a", "b")).toBeUndefined();
  });

  test("a list is the value itself, else the first key holding one, and a map's values only when asked", () => {
    expect(listIn([1, 2], ["x"])).toEqual([1, 2]);
    expect(listIn({ x: "no", y: [3] }, ["x", "y"])).toEqual([3]);
    expect(listIn({ x: { a: 1, b: 2 } }, ["x"])).toBeNull();
    expect(listIn({ x: { a: 1, b: 2 } }, ["x"], true)).toEqual([1, 2]);
    expect(objectsIn({ clients: [{ id: 1 }, "x", null, { id: 2 }] }, "clients")).toEqual([{ id: 1 }, { id: 2 }]);
    expect(objectsIn([{ id: 1 }], "clients")).toEqual([]);
  });
});

describe("the foreground check and tmux's socket", () => {
  test("no pid leads a terminal that isn't there", () => {
    expect(leadsTerminal(0)).toBeNull();
    expect(leadsTerminal(-1)).toBeNull();
    expect(holdsInput(0, "/dev/ttys001")).toBe(false);
  });

  test("the socket is the first field of TMUX, and nothing outside tmux", () => {
    expect(tmuxSocket({ TMUX: "/tmp/tmux-501/default,1234,0" })).toBe("/tmp/tmux-501/default");
    expect(tmuxSocket({ TMUX: "" })).toBeUndefined();
    expect(tmuxSocket({})).toBeUndefined();
  });
});
