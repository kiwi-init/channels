import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseSync } from "oxc-parser";
import { GRACE_MS, running } from "../scripts/ci-owned.ts";
import { spawnOwned } from "./owned.ts";

setDefaultTimeout(60_000);

const ROOT = resolve(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "kiwi-owned-"));
const BOUND_MS = GRACE_MS + 1_000 + 2_000;

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function pidsIn(report: string): number[] {
  return readFileSync(report, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const e: unknown = JSON.parse(l);
      return typeof e === "object" && e !== null && "pid" in e && Number.isSafeInteger(e.pid) ? Number(e.pid) : -1;
    });
}

async function ownedRun(how: "pass" | "fail" | "timeout" | "signal", signal?: "SIGINT" | "SIGTERM") {
  const report = join(dir, `${how}-${signal ?? "none"}.jsonl`);
  const sentinel = spawnOwned(["sleep", "300"]);
  const run = spawnOwned([process.execPath, "test", "./test/fixtures/owned-run.ts"], { cwd: ROOT, env: { ...process.env, OWNED_CASE: how, OWNED_REPORT: report }, stdout: "pipe", stderr: "pipe" });
  if (signal) {
    const end = Date.now() + 30_000;
    while (!existsSync(report) && Date.now() < end) await Bun.sleep(50);
    run.kill(signal);
  }
  const sent = Date.now();
  const code = await Promise.race([run.exited, Bun.sleep(30_000).then(() => null)]);
  const took = Date.now() - sent;
  const pids = pidsIn(report);
  return { code, took, pids, left: pids.filter(running), sentinel };
}

test("an owned run cleans up its children, a child that ignores TERM and its detached daemon, whether the test passes, fails or times out", async () => {
  for (const how of ["pass", "fail", "timeout"] as const) {
    const r = await ownedRun(how);
    expect({ how, exited: r.code !== null }).toEqual({ how, exited: true });
    expect(r.code === 0).toBe(how === "pass");
    expect(r.pids.length).toBe(3);
    expect({ how, left: r.left }).toEqual({ how, left: [] });
    expect({ how, sentinel: running(r.sentinel.pid) }).toEqual({ how, sentinel: true });
    r.sentinel.kill();
  }
});

test("an owned run stopped by SIGINT or SIGTERM cleans up the same, within the TERM grace and the kill that follows it", async () => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const r = await ownedRun("signal", signal);
    expect({ signal, exited: r.code !== null }).toEqual({ signal, exited: true });
    expect(r.took).toBeLessThan(BOUND_MS);
    expect(r.pids.length).toBe(3);
    expect({ signal, left: r.left }).toEqual({ signal, left: [] });
    expect({ signal, sentinel: running(r.sentinel.pid) }).toEqual({ signal, sentinel: true });
    r.sentinel.kill();
  }
});

test("a parallel run under scripts/ci-tests.ts stopped by SIGINT or SIGTERM leaves nothing its workers started, and removes its own temp root", async () => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const report = join(dir, `runner-${signal}.jsonl`);
    const sentinel = spawnOwned(["sleep", "300"]);
    const own = join(dir, `tmp-${signal}`);
    mkdirSync(own);
    const runner = spawnOwned([process.execPath, "scripts/ci-tests.ts", "all"], {
      cwd: ROOT,
      env: { ...process.env, TMPDIR: own, KIWI_CI_ONLY: "./test/fixtures/owned-run.ts", OWNED_CASE: "signal", OWNED_REPORT: report },
      stdout: "pipe",
      stderr: "pipe",
    });
    const end = Date.now() + 30_000;
    while (!existsSync(report) && Date.now() < end) await Bun.sleep(50);
    await Bun.sleep(300);
    const roots = [...new Bun.Glob("kiwi-tmp-*").scanSync({ cwd: own, onlyFiles: false })];
    expect(roots.length).toBeGreaterThan(0);
    runner.kill(signal);
    const sent = Date.now();
    const code = await Promise.race([runner.exited, Bun.sleep(30_000).then(() => null)]);
    const pids = pidsIn(report);
    expect({ signal, exited: code !== null }).toEqual({ signal, exited: true });
    expect(Date.now() - sent).toBeLessThan(BOUND_MS + GRACE_MS);
    expect(pids.length).toBe(3);
    expect({ signal, left: pids.filter(running) }).toEqual({ signal, left: [] });
    expect({ signal, roots: roots.filter((r) => existsSync(join(own, r))) }).toEqual({ signal, roots: [] });
    expect({ signal, sentinel: running(sentinel.pid) }).toEqual({ signal, sentinel: true });
    sentinel.kill();
  }
});

const fields = (node: unknown): Record<string, unknown> => (node && typeof node === "object" && !Array.isArray(node) ? Object.fromEntries(Object.entries(node)) : {});

const rawSpawns = (file: string): number => {
  let found = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    const n = fields(node);
    const callee = fields(n.callee);
    const object = fields(callee.object);
    const property = fields(callee.property);
    if (n.type === "CallExpression" && callee.type === "MemberExpression" && object.type === "Identifier" && object.name === "Bun" && (property.name === "spawn" || property.name === "spawnSync"))
      found++;
    for (const v of Object.values(n)) if (v && typeof v === "object") walk(v);
  };
  walk(parseSync(file, readFileSync(join(ROOT, file), "utf8")).program);
  return found;
};

test("test files start processes only through the owned helpers, so every child is in a ledger; script text they write is left alone", () => {
  const files = [...new Bun.Glob("test/**/*.ts").scanSync({ cwd: ROOT })].filter((f) => f !== "test/owned.ts" && !f.startsWith("test/fixtures/"));
  expect(files.length).toBeGreaterThan(50);
  expect(files.filter((f) => rawSpawns(f) > 0)).toEqual([]);
  expect(rawSpawns("test/fixtures/place-quit.ts")).toBe(1);
});
