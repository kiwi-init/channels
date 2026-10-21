import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const real = { ...fs };
const at: { takeover?: (path: string) => void; linking?: (path: string) => void; removed?: (path: string) => void } = {};
const once = (key: keyof typeof at, path: string) => {
  const hook = at[key];
  if (!hook) return;
  delete at[key];
  hook(path);
};

mock.module("node:fs", () => ({
  ...real,
  renameSync: (from: fs.PathLike, to: fs.PathLike) => {
    once("takeover", String(from));
    return real.renameSync(from, to);
  },
  rmSync: (path: fs.PathLike, options?: fs.RmOptions) => {
    const lock = /\.pid$/.test(String(path));
    if (lock && options?.force) once("takeover", String(path));
    real.rmSync(path, options);
    if (lock) once("removed", String(path));
  },
  linkSync: (from: fs.PathLike, to: fs.PathLike) => {
    once("linking", String(to));
    return real.linkSync(from, to);
  },
}));

const { holdSession } = await import("../src/hooks/permission.ts");

const home = real.mkdtempSync(join(tmpdir(), "kiwi-permission-lock-"));
const was = process.env.KIWI_HOME;
beforeAll(() => {
  process.env.KIWI_HOME = home;
  real.mkdirSync(join(home, "permission"), { recursive: true });
});
afterAll(() => {
  if (was === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = was;
  real.rmSync(home, { recursive: true, force: true });
});

const lockOf = (session: string) => join(home, "permission", `${session}.pid`);
const leftAside = (session: string) => real.readdirSync(join(home, "permission")).filter((n) => n.startsWith(`${session}.pid.`) && !n.endsWith(".newer"));
const stale = (session: string) => {
  const file = lockOf(session);
  real.writeFileSync(file, "");
  const old = new Date(Date.now() - 60_000);
  real.utimesSync(file, old, old);
  return file;
};

describe("taking over a lock left behind, when another hook acts at the same moment", () => {
  test("a stale lock swapped for a live hook's lock just before the takeover stays with that hook, which learns a newer prompt started", () => {
    const file = stale("sess-live");
    at.takeover = () => real.writeFileSync(file, String(process.pid));
    expect(holdSession("sess-live")).toBeNull();
    expect(real.readFileSync(file, "utf8")).toBe(String(process.pid));
    expect(real.existsSync(`${file}.newer`)).toBe(true);
    expect(leftAside("sess-live")).toEqual([]);
  });

  test("a stale lock swapped for one a hook is still writing stays with that hook too", () => {
    const file = stale("sess-writing");
    at.takeover = () => real.writeFileSync(file, "");
    expect(holdSession("sess-writing")).toBeNull();
    expect(real.readFileSync(file, "utf8")).toBe("");
    expect(leftAside("sess-writing")).toEqual([]);
  });

  test("a newer hook that takes the session while the swapped-in lock is set aside keeps it", () => {
    const file = stale("sess-newer");
    at.takeover = () => real.writeFileSync(file, String(process.pid));
    at.linking = () => real.writeFileSync(file, String(process.ppid));
    expect(holdSession("sess-newer")).toBeNull();
    expect(real.readFileSync(file, "utf8")).toBe(String(process.ppid));
    expect(real.existsSync(`${file}.newer`)).toBe(true);
    expect(leftAside("sess-newer")).toEqual([]);
  });

  test("a lock that is still stale when set aside is removed, and this hook takes the session", () => {
    const file = stale("sess-dead");
    const held = holdSession("sess-dead");
    expect(held).not.toBeNull();
    expect(real.readFileSync(file, "utf8")).toBe(String(process.pid));
    expect(leftAside("sess-dead")).toEqual([]);
    held!.release();
  });
});

test("letting go removes the newer-prompt mark before the lock, so a hook that takes the session right after keeps the mark it then gets", () => {
  const first = holdSession("sess-order")!;
  const file = lockOf("sess-order");
  let next: ReturnType<typeof holdSession> = null;
  at.removed = (path) => {
    expect(path).toBe(file);
    next = holdSession("sess-order");
    expect(holdSession("sess-order")).toBeNull();
  };
  first.release();
  expect(next).not.toBeNull();
  expect(next!.newer()).toBe(true);
  next!.release();
});
