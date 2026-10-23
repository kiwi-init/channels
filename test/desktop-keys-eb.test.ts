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

const settled = (p: Promise<unknown>, ms = 50): Promise<string> => Promise.race([p.then(() => "answered"), new Promise<string>((r) => setTimeout(() => r("unanswered"), ms))]);

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

  test("a new session closes the old port, so its follows stop, and the old page's waiting requests are dropped, never answered", async () => {
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
    s.last().send({ from: "port", port: 1, data: ok(1) });
    expect(await settled(old)).toBe("unanswered");
  });

  test("a page that's gone: its port closes, its waiting and queued requests are dropped unanswered, a late reply for it goes nowhere, and no restart frame is sent for it", async () => {
    const s = setup();
    s.keys.start();
    const waiting = s.keys.request(SESSION, req(1));
    s.keys.pageGone();
    expect(s.last().got.at(-1)).toEqual({ to: "close", port: 1 });
    s.last().send({ from: "port", port: 1, data: ok(1) });
    s.last().send({ from: "port", port: 1, data: { sub: 1, event: null } });
    expect(await settled(waiting)).toBe("unanswered");
    s.last().exit();
    const queued = s.keys.request(SESSION, req(2));
    s.keys.pageGone();
    s.clock.run();
    expect(await settled(queued)).toBe("unanswered");
    expect(s.frames).toEqual([]);
    expect(s.last().got).toEqual([{ to: "host", m: { type: "init", relay: "https://r.example", dir: "/data", seats: [], person: null } }]);
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

  test("a request made while the Worker is down gets the restart error at restart, before the restart frame, and never reaches the new Worker", async () => {
    const s = setup();
    s.keys.start();
    void s.keys.request(SESSION, req(1));
    s.last().exit();
    const meanwhile = s.keys.request(SESSION, req(2));
    const order: string[] = [];
    void meanwhile.then(() => order.push("reply"));
    s.clock.run();
    await Bun.sleep(0);
    order.push(...s.frames.map(() => "frame"));
    expect(await meanwhile).toEqual({ id: 2, ok: false, error: { kind: "unreachable", message: RESTARTED } });
    expect(order).toEqual(["reply", "frame"]);
    expect(s.last().got).toEqual([
      { to: "host", m: { type: "init", relay: "https://r.example", dir: "/data", seats: [], person: null } },
      { to: "host", m: { type: "port" }, port: 2 },
    ]);
    expect(s.frames).toEqual([{ session: SESSION, restart: true }]);
  });

  test("a follow made while the Worker is down ends as one follow on the new Worker once the page follows again on restart (#789 round 1)", async () => {
    const s = setup();
    const follows: KeysRequest[] = [];
    let nextId = 1;
    const follow = (): Promise<KeysReply> => s.keys.request(SESSION, { id: nextId++, op: "follow", code: "room", since: 0 } as KeysRequest);
    s.keys.start();
    const first = s.keys.request(SESSION, req(99));
    s.last().send({ from: "port", port: 1, data: ok(99) });
    await first;
    s.last().exit();
    const during = follow();
    s.clock.run();
    expect((await during).ok).toBe(false);
    for (const f of s.frames) if ("restart" in f) void follow();
    for (const m of s.last().got) if (m.to === "port") follows.push(m.data as KeysRequest);
    expect(follows.map((f) => f.op)).toEqual(["follow"]);
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
