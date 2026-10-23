import { describe, expect, test } from "bun:test";

import type { KeysReply, KeysRequest } from "../desktop/src/bridge.ts";
import { FLUSH_MS, keysController, RESTARTED, type KeysClock, type KeysDeps, type KeysFrame, type KeysWorker } from "../desktop/src/keys-eb.ts";
import type { KeysAnswer, KeysAsk } from "../desktop/src/keys-host.ts";
import type { FromWorker, ToWorker } from "../desktop/src/keys-shim.ts";

interface FakeWorker extends KeysWorker {
  got: ToWorker[];
  send(m: FromWorker): void;
  exit(): void;
  killed: boolean;
}

function fakeWorker(): FakeWorker {
  let onMessage: (m: FromWorker) => void = () => {};
  let onExit: () => void = () => {};
  const w: FakeWorker = {
    got: [],
    killed: false,
    post: (m) => void w.got.push(m),
    onMessage: (fn) => void (onMessage = fn),
    onExit: (fn) => void (onExit = fn),
    kill: () => {
      w.killed = true;
      onExit();
    },
    send: (m) => onMessage(m),
    exit: () => onExit(),
  };
  return w;
}

interface FakeClock extends KeysClock {
  at: number;
  waits: number[];
  run(): void;
}

function fakeClock(): FakeClock {
  let next = 1;
  const timers = new Map<number, () => void>();
  const c: FakeClock = {
    at: 0,
    waits: [],
    now: () => c.at,
    later: (fn, ms) => {
      const id = next++;
      timers.set(id, fn);
      c.waits.push(ms);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clear: (t) => void timers.delete(t as unknown as number),
    run: () => {
      const due = [...timers.values()];
      timers.clear();
      for (const fn of due) fn();
    },
  };
  return c;
}

const req = (id: number): KeysRequest => ({ id, op: "nudge" }) as KeysRequest;
const ok = (id: number): KeysReply => ({ id, ok: true, value: null });

function setup(answer: KeysDeps["answer"] = (_m, done) => done()) {
  const workers: FakeWorker[] = [];
  const frames: KeysFrame[] = [];
  const clock = fakeClock();
  const keys = keysController({
    spawn: () => {
      const w = fakeWorker();
      workers.push(w);
      return w;
    },
    init: () => ({ type: "init", relay: "https://r.example", dir: "/data", seats: [], person: null }),
    answer,
    toPage: (f) => void frames.push(f),
    clock,
  });
  const last = (): FakeWorker => workers.at(-1) as FakeWorker;
  return { keys, workers, frames, clock, last };
}

const SESSION = "0123456789abcdef0123456789abcdef";

describe("the keys Worker, from main", () => {
  test("init goes first, and requests made before the Worker is up wait, then go over one port for their page", async () => {
    const s = setup();
    const early = s.keys.request(SESSION, req(1));
    s.keys.start();
    expect(s.last().got).toEqual([
      { to: "host", m: { type: "init", relay: "https://r.example", dir: "/data", seats: [], person: null } },
      { to: "host", m: { type: "port" }, port: 1 },
      { to: "port", port: 1, data: req(1) },
    ]);
    s.last().send({ from: "port", port: 1, data: ok(1) });
    expect(await early).toEqual(ok(1));
  });

  test("a push goes to the page with its session, and a reply or push from a port that isn't the page's is dropped", async () => {
    const s = setup();
    s.keys.start();
    const r = s.keys.request(SESSION, req(1));
    s.last().send({ from: "port", port: 1, data: { sub: 1, event: null } });
    s.last().send({ from: "port", port: 9, data: { sub: 2, event: null } });
    s.last().send({ from: "port", port: 9, data: ok(1) });
    s.last().send({ from: "port", port: 1, data: ok(1) });
    expect(await r).toEqual(ok(1));
    expect(s.frames).toEqual([{ session: SESSION, push: { sub: 1, event: null } }]);
  });

  test("a reload's new session closes the old port, so its follows stop, and the old page's waiting requests are answered", async () => {
    const s = setup();
    s.keys.start();
    const old = s.keys.request(SESSION, req(1));
    const fresh = "fedcba9876543210fedcba9876543210";
    void s.keys.request(fresh, req(1));
    expect(s.last().got.slice(-3)).toEqual([
      { to: "close", port: 1 },
      { to: "host", m: { type: "port" }, port: 2 },
      { to: "port", port: 2, data: req(1) },
    ]);
    expect((await old).ok).toBe(false);
  });

  test("the Worker's asks are answered by the host, and an answer for a Worker that has gone is dropped", () => {
    const answers: ((extra?: KeysAnswer) => void)[] = [];
    const asked: KeysAsk[] = [];
    const s = setup((m, done) => {
      asked.push(m);
      answers.push(done);
    });
    s.keys.start();
    const first = s.last();
    first.send({ from: "host", m: { type: "githubToken", id: 7 } });
    answers[0]?.({ token: "t" });
    expect(first.got.at(-1)).toEqual({ to: "host", m: { type: "done", id: 7, token: "t" } });
    first.send({ from: "host", m: { type: "forget", id: 8, code: "c" } });
    first.exit();
    s.clock.run();
    answers[1]?.();
    expect(first.got.at(-1)).toEqual({ to: "host", m: { type: "done", id: 7, token: "t" } });
    expect(asked.map((m) => m.type)).toEqual(["githubToken", "forget"]);
  });

  test("a Worker that dies: waiting requests get the restart error, it comes back after 2 s, 4 s … up to 30 s, and after a minute up the wait is 1 s again", async () => {
    const s = setup();
    s.keys.start();
    const waiting = s.keys.request(SESSION, req(1));
    s.last().exit();
    expect(await waiting).toEqual({ id: 1, ok: false, error: { kind: "unreachable", message: RESTARTED } });
    for (let i = 0; i < 6; i++) {
      s.clock.run();
      s.last().exit();
    }
    expect(s.clock.waits).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
    s.clock.run();
    s.clock.at += 61_000;
    s.last().exit();
    expect(s.clock.waits.at(-1)).toBe(1_000);
    expect(s.workers.length).toBe(8);
  });

  test("once it's back, the page gets a fresh port and a restart frame, and requests made meanwhile wait for it", async () => {
    const s = setup();
    s.keys.start();
    void s.keys.request(SESSION, req(1));
    s.last().exit();
    const meanwhile = s.keys.request(SESSION, req(2));
    s.clock.run();
    const back = s.last();
    expect(back.got).toEqual([
      { to: "host", m: { type: "init", relay: "https://r.example", dir: "/data", seats: [], person: null } },
      { to: "host", m: { type: "port" }, port: 2 },
      { to: "port", port: 2, data: req(2) },
    ]);
    expect(s.frames).toEqual([{ session: SESSION, restart: true }]);
    back.send({ from: "port", port: 2, data: ok(2) });
    expect(await meanwhile).toEqual(ok(2));
  });

  test("tellKeys reaches the Worker that's up, and nothing while it's down", () => {
    const s = setup();
    s.keys.tell({ type: "nudge" });
    s.keys.start();
    s.keys.tell({ type: "relay", relay: "https://moved.example" });
    expect(s.last().got.at(-1)).toEqual({ to: "host", m: { type: "relay", relay: "https://moved.example" } });
  });
});

describe("quitting", () => {
  test("flush asks the Worker to write what it holds, ends it once it says flushed, and nothing restarts", async () => {
    const s = setup();
    s.keys.start();
    const w = s.last();
    const done = s.keys.flush();
    expect(w.got.at(-1)).toEqual({ to: "host", m: { type: "flush" } });
    w.send({ from: "host", m: { type: "flushed", id: 0 } });
    await done;
    expect(w.killed).toBe(true);
    expect(s.workers.length).toBe(1);
    expect(s.keys.open()).toBe(false);
    expect((await s.keys.request(SESSION, req(1))).ok).toBe(false);
  });

  test("a Worker that never says flushed is ended after 1 s", async () => {
    const s = setup();
    s.keys.start();
    const done = s.keys.flush();
    expect(s.clock.waits).toEqual([FLUSH_MS]);
    s.clock.run();
    await done;
    expect(s.last().killed).toBe(true);
    expect(s.workers.length).toBe(1);
  });

  test("flush with no Worker up returns at once", async () => {
    const s = setup();
    await s.keys.flush();
    expect(s.workers.length).toBe(0);
  });
});
