import { afterAll, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const logs = mkdtempSync(join(tmpdir(), "kiwi-revive-"));
afterAll(() => rmSync(logs, { recursive: true, force: true }));
let answer = 1;
const asked: string[] = [];
let quits = 0;
mock.module("electron", () => ({
  app: { getPath: () => logs, quit: () => void quits++ },
  dialog: {
    showMessageBox: async (_w: unknown, o: { message: string }) => {
      asked.push(o.message);
      return { response: answer };
    },
  },
}));

type FakeWindow = { webContents: EventEmitter & { reload: () => void; forcefullyCrashRenderer: () => void }; on: (ev: string, fn: () => void) => void; isDestroyed: () => boolean };
const revive = "../desktop/src/revive.ts";
const { keepRendererAlive, catchMainErrors } = (await import(revive)) as {
  keepRendererAlive: (win: FakeWindow, quitting: () => boolean, now?: () => number) => void;
  catchMainErrors: () => void;
};

function fakeWindow(): { win: FakeWindow; wc: EventEmitter; on: EventEmitter; reloads: () => number; crashes: () => number } {
  const wc = Object.assign(new EventEmitter(), { reloads: 0, crashes: 0 });
  const on = new EventEmitter();
  const contents = Object.assign(wc, { reload: () => void wc.reloads++, forcefullyCrashRenderer: () => void wc.crashes++ });
  const win: FakeWindow = { webContents: contents, on: (ev, fn) => void on.on(ev, fn), isDestroyed: () => false };
  return { win, wc, on, reloads: () => wc.reloads, crashes: () => wc.crashes };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("three crashes in a minute reload by themselves, the fourth asks, and crashes older than a minute don't count", async () => {
  let t = 0;
  const w = fakeWindow();
  keepRendererAlive(
    w.win,
    () => false,
    () => t,
  );
  answer = 1;
  for (const at of [0, 1_000, 2_000]) {
    t = at;
    w.wc.emit("render-process-gone", {}, { reason: "crashed", exitCode: 11 });
  }
  expect(asked).toEqual([]);
  t = 3_000;
  w.wc.emit("render-process-gone", {}, { reason: "crashed", exitCode: 11 });
  await tick();
  expect(asked).toEqual(["Channels' window keeps stopping."]);
  t = 3_000 + 61_000;
  w.wc.emit("render-process-gone", {}, { reason: "crashed", exitCode: 11 });
  await tick();
  expect(asked).toHaveLength(1);
  expect(w.reloads()).toBe(5);
});

test("a crashed page reloads, a clean exit doesn't, and one that keeps crashing asks whether to reload or quit", async () => {
  const w = fakeWindow();
  keepRendererAlive(w.win, () => false);
  w.wc.emit("render-process-gone", {}, { reason: "clean-exit", exitCode: 0 });
  expect(w.reloads()).toBe(0);
  for (let i = 0; i < 3; i++) w.wc.emit("render-process-gone", {}, { reason: "crashed", exitCode: 11 });
  expect(w.reloads()).toBe(3);
  answer = 1;
  w.wc.emit("render-process-gone", {}, { reason: "oom", exitCode: 9 });
  await tick();
  expect(asked.at(-1)).toBe("Channels' window keeps stopping.");
  expect(w.reloads()).toBe(4);
  answer = 0;
  w.wc.emit("render-process-gone", {}, { reason: "crashed", exitCode: 11 });
  await tick();
  expect(quits).toBe(1);
  expect(readFileSync(join(logs, "main.log"), "utf8")).toContain("the window's page stopped (oom, exit 9)");
});

test("a hung page asks to wait or reload, and Reload ends the stuck page so it comes back", async () => {
  const w = fakeWindow();
  keepRendererAlive(w.win, () => false);
  answer = 0;
  w.on.emit("unresponsive");
  await tick();
  expect(asked.at(-1)).toBe("Channels' window isn't responding.");
  expect(w.crashes()).toBe(0);
  answer = 1;
  w.on.emit("unresponsive");
  await tick();
  expect(w.crashes()).toBe(1);
});

test("a main-process error nobody caught is written to main.log with its stack", () => {
  const before = process.listeners("uncaughtException").length;
  catchMainErrors();
  const added = process.listeners("uncaughtException").slice(before);
  for (const l of added) l(new Error("the store went away"), "uncaughtException");
  for (const l of added) process.off("uncaughtException", l);
  for (const l of process.listeners("unhandledRejection").slice(-1)) process.off("unhandledRejection", l);
  expect(readFileSync(join(logs, "main.log"), "utf8")).toMatch(/Z Error: the store went away\n\s+at /);
});
