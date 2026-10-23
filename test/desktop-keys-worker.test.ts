import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { KeysReply, KeysRequest } from "../desktop/src/bridge.ts";
import { bunWorker, keysController, type KeysFrame, type KeysWorker } from "../desktop/src/keys-eb.ts";

const WORKER = join(import.meta.dir, "..", "desktop", "src", "keys-worker.ts");
const SESSION = "0123456789abcdef0123456789abcdef";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function start() {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-keys-worker-"));
  dirs.push(dir);
  const workers: KeysWorker[] = [];
  const frames: KeysFrame[] = [];
  const keys = keysController({
    spawn: () => {
      const w = bunWorker(WORKER);
      workers.push(w);
      return w;
    },
    init: () => ({ type: "init", relay: "https://relay.invalid", dir, seats: [], person: null }),
    answer: (_m, done) => done(),
    toPage: (f) => void frames.push(f),
    clock: { now: () => Date.now(), later: (fn) => setTimeout(fn, 10), clear: (t) => clearTimeout(t) },
  });
  keys.start();
  return { keys, dir, workers, frames };
}

const nudge = (id: number): KeysRequest => ({ id, op: "nudge" }) as KeysRequest;

test("channels.ts, unchanged, answers a page's request through the Worker, and a flush writes what it holds", async () => {
  const s = start();
  expect(await s.keys.request(SESSION, nudge(1))).toEqual({ id: 1, ok: true, value: null } satisfies KeysReply);
  const bad = await s.keys.request(SESSION, { id: 2, op: "no-such-op" } as unknown as KeysRequest);
  expect(bad.ok).toBe(false);
  const started = performance.now();
  await s.keys.flush();
  expect(performance.now() - started).toBeLessThan(900);
  expect(existsSync(join(s.dir, "kiwi-keys-memory.json"))).toBe(true);
  expect(s.keys.open()).toBe(false);
});

test("a Worker that ends is started again: what was waiting gets the restart error, and the page gets a fresh port and a restart frame", async () => {
  const s = start();
  expect((await s.keys.request(SESSION, nudge(1))).ok).toBe(true);
  s.workers[0]?.kill();
  for (let i = 0; i < 200 && s.frames.length === 0; i++) await Bun.sleep(10);
  expect(s.frames).toEqual([{ session: SESSION, restart: true }]);
  expect(s.workers.length).toBe(2);
  expect(await s.keys.request(SESSION, nudge(2))).toEqual({ id: 2, ok: true, value: null });
  await s.keys.flush();
});
