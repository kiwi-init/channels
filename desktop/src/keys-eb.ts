import type { KeysPush, KeysReply, KeysRequest } from "./bridge.ts";
import type { KeysAnswer, KeysAsk } from "./keys-host.ts";
import type { HostToKeys } from "./keys-server.ts";
import type { FromWorker, ToWorker } from "./keys-shim.ts";

export type KeysFrame = { session: string; push: KeysPush } | { session: string; restart: true };

export interface KeysWorker {
  post(m: ToWorker): void;
  onMessage(fn: (m: FromWorker) => void): void;
  onExit(fn: () => void): void;
  kill(): void;
}

type Timer = ReturnType<typeof setTimeout>;

export interface KeysClock {
  now(): number;
  later(fn: () => void, ms: number): Timer;
  clear(t: Timer): void;
}

export interface KeysDeps {
  spawn(): KeysWorker;
  init(): HostToKeys;
  answer(m: KeysAsk, done: (extra?: KeysAnswer) => void): void;
  toPage(frame: KeysFrame): void;
  clock?: KeysClock;
}

export interface Keys {
  start(): void;
  pageGone(): void;
  tell(m: HostToKeys): void;
  request(session: string, req: KeysRequest): Promise<KeysReply>;
  flush(): Promise<void>;
  open(): boolean;
}

export const RESTARTED = "Channels restarted the part that holds your keys; try again";

export const FLUSH_MS = 1_000;

const realClock: KeysClock = { now: () => Date.now(), later: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) };

const unreachable = (id: number, message: string): KeysReply => ({ id, ok: false, error: { kind: "unreachable", message } });

export function keysController(deps: KeysDeps): Keys {
  const clock = deps.clock ?? realClock;
  let worker: KeysWorker | null = null;
  let wait = 1_000;
  let stopping = false;
  let flushed: (() => void) | null = null;
  let page: { session: string; port: number } | null = null;
  let lastSession: string | null = null;
  let nextPort = 1;
  const pending = new Map<number, (r: KeysReply) => void>();
  const queued: { session: string; req: KeysRequest; done: (r: KeysReply) => void }[] = [];

  const failAll = (message: string): void => {
    for (const [id, done] of pending) done(unreachable(id, message));
    pending.clear();
  };

  function forgetPage(w: KeysWorker | null): void {
    if (page && w) w.post({ to: "close", port: page.port });
    page = null;
    pending.clear();
  }

  function connect(w: KeysWorker, session: string): { session: string; port: number } {
    if (page && page.session !== session) forgetPage(w);
    const next = { session, port: nextPort++ };
    page = next;
    lastSession = session;
    w.post({ to: "host", m: { type: "port" }, port: next.port });
    return next;
  }

  function send(w: KeysWorker, session: string, req: KeysRequest, done: (r: KeysReply) => void): void {
    const to = page && page.session === session ? page : connect(w, session);
    pending.get(req.id)?.(unreachable(req.id, "a newer request took this one's id"));
    pending.set(req.id, done);
    w.post({ to: "port", port: to.port, data: req });
  }

  function onWorker(w: KeysWorker, m: FromWorker): void {
    if (m.from === "port") {
      if (!page || m.port !== page.port) return;
      const d = m.data;
      if ("sub" in d) return deps.toPage({ session: page.session, push: d });
      pending.get(d.id)?.(d);
      pending.delete(d.id);
      return;
    }
    if (m.m.type === "flushed") return flushed?.();
    const ask = m.m;
    deps.answer(ask, (extra = {}) => {
      if (worker === w) w.post({ to: "host", m: { type: "done", id: ask.id, ...extra } });
    });
  }

  function start(): void {
    if (stopping) return;
    const w = deps.spawn();
    const started = clock.now();
    worker = w;
    w.onMessage((m) => onWorker(w, m));
    w.onExit(() => {
      if (worker !== w) return;
      worker = null;
      page = null;
      failAll(RESTARTED);
      if (stopping) return;
      wait = clock.now() - started > 60_000 ? 1_000 : Math.min(wait * 2, 30_000);
      clock.later(() => {
        const died = lastSession;
        const waiting = queued.splice(0);
        for (const q of waiting) if (q.session === died) q.done(unreachable(q.req.id, RESTARTED));
        queued.push(...waiting.filter((q) => q.session !== died));
        start();
        if (!died || !worker) return;
        if (!page) connect(worker, died);
        deps.toPage({ session: died, restart: true });
      }, wait);
    });
    w.post({ to: "host", m: deps.init() });
    for (const q of queued.splice(0)) send(w, q.session, q.req, q.done);
  }

  return {
    start,
    pageGone: () => {
      forgetPage(worker);
      queued.length = 0;
      lastSession = null;
    },
    tell: (m) => worker?.post({ to: "host", m }),
    request: (session, req) =>
      new Promise<KeysReply>((done) => {
        if (stopping) return done(unreachable(req.id, "Channels is quitting"));
        if (!worker) return void queued.push({ session, req, done });
        send(worker, session, req, done);
      }),
    flush: () => {
      stopping = true;
      for (const q of queued.splice(0)) q.done(unreachable(q.req.id, "Channels is quitting"));
      const w = worker;
      if (!w) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const finish = (): void => {
          flushed = null;
          clock.clear(timer);
          worker = null;
          failAll("Channels is quitting");
          w.kill();
          resolve();
        };
        const timer = clock.later(finish, FLUSH_MS);
        flushed = finish;
        w.post({ to: "host", m: { type: "flush" } });
      });
    },
    open: () => !stopping && worker !== null,
  };
}

export function bunWorker(file: string): KeysWorker {
  const w = new Worker(file);
  return {
    post: (m) => w.postMessage(m),
    onMessage: (fn) => w.addEventListener("message", (e: MessageEvent<FromWorker>) => fn(e.data)),
    onExit: (fn) => w.addEventListener("close", () => fn()),
    kill: () => w.terminate(),
  };
}
