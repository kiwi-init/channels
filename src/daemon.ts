// kiwi daemon: one long-running process per KIWI_HOME. The app and the CLI talk to it over
// $KIWI_HOME/daemon.sock (a named pipe on Windows), newline-delimited JSON: {id, verb, ...} in,
// {id, ok, ...} out. It owns two things:
//
//   - this computer's key and cert (machine.json, re-read on every request, so `kiwi pair`
//     changing it just works), plus `adopt` for the app handing the cert to its own computer;
//   - one live relay stream per local agent seat, shared by every subscriber of that agent
//     (`listen`); each subscriber still gets its deliveries from its own cursor.
//
// The multiplex runs over client.ts's Promise API (history for catch-up, one stream() per seat),
// not over an agent session: the relay authenticates one socket as one member key, and presence
// and read marks are per agent — which is exactly why the daemon keeps one stream per seat and
// shares it. A CLI that finds an older daemon stops it and starts its own.
// `kiwi pair` (below) pairs the computer through the relay's pairing mailbox.

import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Socket } from "bun";
// The channel stack (client.ts) loads lazily in seatFor, where the multiplex needs it: pairing,
// hello/adopt and the socket itself never touch it, so `kiwi pair` works without it.
import type { Channel } from "./client.ts";
import type { Message } from "./protocol.ts";
import { DEFAULT_RELAY, hasKiwiState, home, identitiesIn, loadConfig, loadIdentity } from "./config.ts";
import { withExchangeKey } from "./identity.ts";
import { loadMachine, newMachine, saveMachine, type MachineFile } from "./machine.ts";
import { MAILBOX_TTL_MS, MailboxError, askToPair, openMailbox, readPairAnswer, readPairCode } from "./mailbox.ts";
import { readMachineCert, type MachineCert } from "./person.ts";
import { VERSION } from "./version.ts";

/** Who paired this computer: the person's key, exchange key and name, as their app answered. */
export interface PairedPerson {
  pk: string;
  xpk: string;
  name: string;
}

/**
 * machine.json once paired: this computer's key, its cert from the person, and who they are.
 * Kept inside machine.ts's MachineFile — same path, same 0600 write — because the cert replaces
 * the old relay-side link, it doesn't sit next to it: one file still says which person this
 * computer belongs to.
 */
export interface PairedMachine extends MachineFile {
  cert?: MachineCert;
  person?: PairedPerson;
}

export function loadPairedMachine(): PairedMachine | null {
  return loadMachine() as PairedMachine | null;
}

/** This computer's key, made on first use (labelled after the computer) and kept ever after. */
async function ensureMachine(relay: string): Promise<PairedMachine> {
  let m = loadPairedMachine();
  if (!m) {
    m = (await newMachine(relay)) as PairedMachine;
    saveMachine(m);
    return m;
  }
  // Keys from before exchange keys can't pair (the ask carries mxpk): grow one in place.
  if (!m.identity.xpk) {
    m = { ...m, identity: await withExchangeKey(m.identity) };
    saveMachine(m);
  }
  // An unpaired machine follows the relay it is being paired (or started) through; a paired
  // one keeps the relay its person approved, whatever the environment says now.
  if (!m.cert && m.relay !== relay) {
    m = { ...m, relay };
    saveMachine(m);
  }
  return m;
}

/** Where this home's daemon listens: a socket file, or a named pipe on Windows. */
export function daemonSock(dir = home()): string {
  if (process.platform === "win32") {
    const tag = dir.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(-64) || "kiwi";
    return `\\\\.\\pipe\\kiwi-daemon-${tag}`;
  }
  return join(dir, "daemon.sock");
}

// ---------- the socket protocol ----------

export type DaemonVerb = "hello" | "adopt" | "listen" | "listening" | "stop";

export interface DaemonHello {
  version: string;
  pid: number;
  machine: string | null;
  mxpk: string | null;
  label: string | null;
  relay: string | null;
  person: PairedPerson | null;
  certified: boolean;
}

export interface DaemonSeat {
  channel: string;
  agent: string;
  subscribers: number;
}

interface Seat {
  key: string;
  alias: string;
  agent: string;
  ch: Channel;
  ctl: AbortController;
  subs: Set<Sub>;
  head: number;
}

interface Sub {
  id: number;
  cursor: number;
  conn: ConnState;
  seat: Seat;
}

interface ConnState {
  socket: Socket;
  decoder: TextDecoder;
  buf: string;
  subs: Set<Sub>;
  dead: boolean;
}

export interface Daemon {
  readonly sock: string;
  stop(): Promise<void>;
  /** Resolves when the daemon stops, however it was told (socket `stop`, `stop()`, a crash of the server). */
  readonly stopped: Promise<void>;
}

/** Serve this home's daemon (used by `kiwi daemon`, and by tests in-process). Refuses when one already answers. */
export async function startDaemon(dir = home()): Promise<Daemon> {
  const sock = daemonSock(dir);
  if (await tryHello(sock)) throw new Error(`a daemon is already answering on ${sock}`);
  const existed = existsSync(dir);
  const ours = existed && hasKiwiState(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // A socket file left by a crashed daemon; pipe names need no cleanup.
  if (process.platform !== "win32") {
    try {
      rmSync(sock, { force: true });
    } catch {
      // Giving up a stale path is the next line's error, not this one's.
    }
  }
  await ensureMachine(process.env.KIWI_RELAY ?? DEFAULT_RELAY);
  // mkdirSync(mode) does not chmod an existing dir. Lock 0700 only when this is kiwi's
  // own home (we created it, or it already held kiwi state). KIWI_HOME is user-supplied:
  // do not chmod ~ or a project. (macOS ignores unix-socket mode and checks the directory.)
  if (process.platform !== "win32" && (!existed || ours)) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // A directory this user can't chmod must not stop the daemon.
    }
  }

  const seats = new Map<string, Seat>();
  const conns = new Set<ConnState>();
  let stopped = false;
  let resolveStopped: () => void = () => {};
  const stoppedP = new Promise<void>((resolve) => (resolveStopped = resolve));

  // reason() without importing the channel stack (see the note at the top): a refusal's text.
  const why = (err: unknown): string => (err instanceof Error ? err.message : String(err));
  // Seats being opened: concurrent first-subscribers share one relay stream, not one each.
  const opening = new Map<string, Promise<Seat>>();

  const sendLine = (conn: ConnState, line: string): boolean => {
    if (conn.dead) return false;
    try {
      conn.socket.write(line + "\n");
      return true;
    } catch {
      killConn(conn);
      return false;
    }
  };

  const killConn = (conn: ConnState): void => {
    if (conn.dead) return;
    conn.dead = true;
    conns.delete(conn);
    for (const sub of [...conn.subs]) dropSub(sub);
  };

  const dropSub = (sub: Sub): void => {
    sub.conn.subs.delete(sub);
    sub.seat.subs.delete(sub);
    // Nobody left on this seat: close its stream. A later subscriber reopens it fresh.
    if (sub.seat.subs.size === 0 && !stopped) {
      if (seats.get(sub.seat.key) === sub.seat) seats.delete(sub.seat.key);
      sub.seat.ctl.abort();
    }
  };

  const seatEnded = (seat: Seat, err: unknown): void => {
    if (seats.get(seat.key) !== seat) return; // reaped when its last subscriber left
    seats.delete(seat.key);
    if (err === null) return;
    for (const sub of [...seat.subs]) {
      sendLine(sub.conn, JSON.stringify({ id: sub.id, ok: false, error: `the channel stream ended: ${why(err)}` }));
      dropSub(sub);
    }
  };

  const seatFor = async (alias: string, agent: string): Promise<Seat> => {
    const cfg = loadConfig();
    const c = cfg.channels[alias];
    if (!c) throw new Error(`unknown channel "${alias}" on this computer (see: kiwi channels)`);
    if (!identitiesIn(c.roomId).includes(agent)) throw new Error(`no key for agent "${agent}" in "${alias}" on this computer (join first)`);
    const id = await loadIdentity(agent, c.roomId);
    const key = `${c.roomId}/${id.pk}`;
    const hit = seats.get(key);
    if (hit) return hit;
    const inflight = opening.get(key);
    if (inflight) return inflight;
    const open = (async (): Promise<Seat> => {
      const { Channel } = await import("./client.ts");
      const ch = new Channel(c, c.relay, id);
      const head = await ch.head().catch((err: unknown) => {
        throw new Error(why(err));
      });
      const seat: Seat = { key, alias, agent, ch, ctl: new AbortController(), subs: new Set(), head };
      seats.set(key, seat);
      ch.stream(
        seat.head,
        (m) => {
          if (m.seq > seat.head) seat.head = m.seq;
          for (const sub of [...seat.subs]) {
            if (m.seq <= sub.cursor) continue;
            if (sendLine(sub.conn, JSON.stringify({ id: sub.id, message: m }))) sub.cursor = m.seq;
          }
        },
        { signal: seat.ctl.signal },
      ).then(
        () => seatEnded(seat, null),
        (err: unknown) => seatEnded(seat, seat.ctl.signal.aborted ? null : err),
      );
      return seat;
    })();
    opening.set(key, open);
    try {
      return await open;
    } finally {
      if (opening.get(key) === open) opening.delete(key);
    }
  };

  const onListen = async (conn: ConnState, id: number, params: Record<string, unknown>): Promise<void> => {
    const { channel, as, cursor } = params as { channel?: unknown; as?: unknown; cursor?: unknown };
    if (typeof channel !== "string" || !channel || typeof as !== "string" || !as) throw new Error('listen needs {"channel", "as", cursor}');
    if (typeof cursor !== "number" || !Number.isInteger(cursor) || cursor < 0) throw new Error("listen needs a cursor: the last sequence number this subscriber saw (0 for everything)");
    // The seat's stream is already running before the catch-up below, so the two overlap and
    // never gap; the cursor dedupes the overlap.
    const seat = await seatFor(channel, as);
    const sub: Sub = { id, cursor, conn, seat };
    seat.subs.add(sub);
    conn.subs.add(sub);
    sendLine(conn, JSON.stringify({ id, ok: true, stream: true, head: seat.head, channel, agent: as }));
    try {
      const { messages } = await seat.ch.history(cursor);
      for (const m of messages) {
        if (m.seq <= sub.cursor) continue;
        if (sendLine(conn, JSON.stringify({ id, message: m }))) sub.cursor = m.seq;
        else break;
      }
    } catch (err) {
      dropSub(sub);
      sendLine(conn, JSON.stringify({ id, ok: false, error: why(err) }));
    }
  };

  const onRequest = async (conn: ConnState, raw: string): Promise<void> => {
    let req: { id?: unknown; verb?: unknown } & Record<string, unknown>;
    try {
      req = JSON.parse(raw) as typeof req;
    } catch {
      return; // not a request; the next line may be one
    }
    if (!req || typeof req !== "object" || typeof req.id !== "number" || typeof req.verb !== "string") return;
    const id = req.id;
    const verb = req.verb;
    const params: Record<string, unknown> = req;
    try {
      switch (verb as DaemonVerb) {
        case "hello": {
          const m = loadPairedMachine();
          sendLine(
            conn,
            JSON.stringify({
              id,
              ok: true,
              version: VERSION,
              pid: process.pid,
              machine: m?.identity.pk ?? null,
              mxpk: m?.identity.xpk ?? null,
              label: m?.label ?? null,
              relay: m?.relay ?? null,
              person: m?.person ?? null,
              certified: !!m?.cert,
            }),
          );
          break;
        }
        case "adopt": {
          const cert = await readMachineCert(params.cert);
          if (!cert) throw new Error("that cert doesn't check out (wrong signature or shape)");
          const person = params.person as Partial<PairedPerson> | null;
          if (!person || typeof person.pk !== "string" || typeof person.xpk !== "string" || typeof person.name !== "string") {
            throw new Error("adopt needs {cert, person: {pk, xpk, name}}");
          }
          if (person.pk !== cert.pk) throw new Error("that cert is by another person than the one named");
          const m = await ensureMachine(process.env.KIWI_RELAY ?? DEFAULT_RELAY);
          if (cert.machine !== m.identity.pk) throw new Error("that cert is for another computer");
          const paired: PairedMachine = { ...m, cert, person: { pk: person.pk, xpk: person.xpk, name: person.name } };
          saveMachine(paired);
          sendLine(conn, JSON.stringify({ id, ok: true }));
          break;
        }
        case "listen":
          await onListen(conn, id, params);
          break;
        case "listening":
          sendLine(
            conn,
            JSON.stringify({
              id,
              ok: true,
              subscriptions: [...seats.values()].map((s): DaemonSeat => ({ channel: s.alias, agent: s.agent, subscribers: s.subs.size })),
            }),
          );
          break;
        case "stop":
          sendLine(conn, JSON.stringify({ id, ok: true }));
          // After the reply flushes.
          setTimeout(() => void stop(), 50);
          break;
        default:
          throw new Error(`unknown verb "${verb}" (hello, adopt, listen, listening, stop)`);
      }
    } catch (err) {
      sendLine(conn, JSON.stringify({ id, ok: false, error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const server = Bun.listen({
    unix: sock,
    socket: {
      open(socket) {
        conns.add({ socket: socket as Socket, decoder: new TextDecoder(), buf: "", subs: new Set(), dead: false });
      },
      data(socket, data) {
        const conn = [...conns].find((c) => c.socket === socket);
        if (!conn || conn.dead) return;
        conn.buf += conn.decoder.decode(data, { stream: true });
        const lines = conn.buf.split("\n");
        conn.buf = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) void onRequest(conn, line);
      },
      close(socket) {
        const conn = [...conns].find((c) => c.socket === socket);
        if (conn) killConn(conn);
      },
      error() {
        // A conn that errors closes right after, where it is reaped.
      },
    },
  });
  // Unix sockets have no auth: anyone who can connect can stop/listen/adopt. Bun.listen
  // creates the file with a wide mode; lock it to this user. (Windows uses a named pipe.)
  if (process.platform !== "win32") {
    try {
      chmodSync(sock, 0o600);
    } catch {
      // Same as the home chmod: a mode this user can't set must not stop the daemon.
    }
  }

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    resolveStopped();
    for (const conn of [...conns]) {
      try {
        conn.socket.end();
      } catch {
        // Already gone; killConn below still reaps it.
      }
      killConn(conn);
    }
    for (const seat of seats.values()) seat.ctl.abort();
    seats.clear();
    try {
      server.stop();
    } catch {
      // Already stopped; the socket file below is what matters.
    }
    if (process.platform !== "win32") {
      try {
        rmSync(sock, { force: true });
      } catch {
        // A stale socket file is harmless: the next start removes it.
      }
    }
  };

  return { sock, stop, stopped: stoppedP };
}

// ---------- talking to the daemon ----------

type Reply = { id: number; ok: true; [k: string]: unknown } | { id: number; ok: false; error: string };

interface DaemonConn {
  call(verb: string, params?: Record<string, unknown>): Promise<Extract<Reply, { ok: true }>>;
  subscribe(
    params: Record<string, unknown>,
    onMessage: (m: Message) => void,
    onError: (err: Error) => void,
  ): Promise<Extract<Reply, { ok: true }>>;
  closed(): boolean;
  close(): void;
}

interface Pending {
  resolve: (r: Reply) => void;
  reject: (e: Error) => void;
  onMessage?: (m: Message) => void;
  onError?: (e: Error) => void;
  /** A listen reply's first ok resolved the subscribe; later lines are deliveries, then at most one error. */
  live?: boolean;
}

async function openConn(sock: string, timeoutMs = 15_000): Promise<DaemonConn> {
  let buf = "";
  const decoder = new TextDecoder();
  const pending = new Map<number, Pending>();
  let closed = false;
  const failAll = (err: Error): void => {
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  };
  const socket = (await Bun.connect({
    unix: sock,
    socket: {
      data(_s, data) {
        buf += decoder.decode(data, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg: { id?: unknown; ok?: unknown; message?: unknown; error?: unknown } & Record<string, unknown>;
          try {
            msg = JSON.parse(line) as typeof msg;
          } catch {
            continue;
          }
          if (!msg || typeof msg !== "object" || typeof msg.id !== "number") continue;
          const p = pending.get(msg.id);
          if (!p) continue;
          // A listen reply's later lines: deliveries, then at most one error.
          if ("message" in msg && msg.message) {
            p.onMessage?.(msg.message as Message);
            continue;
          }
          if (p.onMessage) {
            if (!msg.ok) {
              pending.delete(msg.id);
              p.onError?.(new Error(typeof msg.error === "string" ? msg.error : "the daemon refused"));
            } else if (!p.live) {
              p.live = true;
              p.resolve(msg as Reply);
            }
            continue;
          }
          pending.delete(msg.id);
          if (msg.ok) p.resolve(msg as Reply);
          else p.reject(new Error(typeof msg.error === "string" ? msg.error : "the daemon refused"));
        }
      },
      close() {
        closed = true;
        failAll(new Error("the daemon closed the connection"));
      },
      error(_s, e) {
        failAll(e instanceof Error ? e : new Error(String(e)));
      },
    },
  }).catch((err: unknown) => {
    throw new Error(`no daemon on ${sock} (start one with: kiwi daemon): ${err instanceof Error ? err.message : String(err)}`);
  })) as Socket;
  let next = 1;
  // The timer never outlives its reply: settling it clears it, so one-shot calls leave no
  // 15-second tail behind (a listen's subscription lives in `pending` instead, by design).
  const send = (body: Record<string, unknown>, entry: Pending): void => {
    const id = next++;
    const timer = setTimeout(() => {
      if (pending.delete(id)) entry.reject(new Error("the daemon didn't answer in time"));
    }, timeoutMs);
    pending.set(id, {
      resolve: (r) => {
        clearTimeout(timer);
        entry.resolve(r);
      },
      reject: (e) => {
        clearTimeout(timer);
        entry.reject(e);
      },
      onMessage: entry.onMessage,
      onError: entry.onError,
    });
    try {
      socket.write(JSON.stringify({ id, ...body }) + "\n");
    } catch (err) {
      pending.delete(id);
      clearTimeout(timer);
      entry.reject(err instanceof Error ? err : new Error(String(err)));
    }
  };
  return {
    closed: () => closed,
    close: () => {
      try {
        socket.end();
      } catch {
        // Already closed; the close handler reaps the rest.
      }
      closed = true;
    },
    call: (verb, params = {}) =>
      new Promise<Extract<Reply, { ok: true }>>((resolve, reject) => {
        send({ verb, ...params }, { resolve: resolve as (r: Reply) => void, reject });
      }),
    subscribe: (params, onMessage, onError) =>
      new Promise<Extract<Reply, { ok: true }>>((resolve, reject) => {
        send({ verb: "listen", ...params }, { resolve: resolve as (r: Reply) => void, reject, onMessage, onError });
      }),
  };
}

/** One hello, no spawning: null when no daemon answers. */
async function tryHello(sock: string): Promise<DaemonHello | null> {
  try {
    const c = await openConn(sock, 2_000);
    try {
      const r = await c.call("hello");
      return {
        version: String(r.version),
        pid: Number(r.pid),
        machine: typeof r.machine === "string" ? r.machine : null,
        mxpk: typeof r.mxpk === "string" ? r.mxpk : null,
        label: typeof r.label === "string" ? r.label : null,
        relay: typeof r.relay === "string" ? r.relay : null,
        person: (r.person ?? null) as PairedPerson | null,
        certified: r.certified === true,
      };
    } finally {
      c.close();
    }
  } catch {
    return null;
  }
}

/** This home's daemon, started in the background when nothing answers (the first listen spawns
 * one). A CLI that finds an older daemon stops it and starts its own. `argv` overrides how the
 * daemon is spawned (tests); unset, it re-runs this very program as `kiwi daemon`. */
export async function ensureDaemon(dir = home(), argv?: string[]): Promise<DaemonHello> {
  const sock = daemonSock(dir);
  const live = await tryHello(sock);
  if (live && live.version === VERSION) return live;
  if (live) await stopDaemon(sock);
  spawnDaemon(dir, argv);
  const until = Date.now() + 15_000;
  for (;;) {
    const hello = await tryHello(sock);
    if (hello && hello.version === VERSION) return hello;
    if (Date.now() > until) throw new Error(`kiwi daemon didn't answer on ${sock}`);
    await Bun.sleep(100);
  }
}

/** Start `kiwi daemon` for `dir` in the background, detached from this process. */
export function spawnDaemon(dir = home(), argv?: string[]): void {
  const cmd = argv ?? cliDaemonArgv();
  const child = spawn(cmd[0]!, cmd.slice(1), { cwd: dir, env: { ...process.env, KIWI_HOME: dir }, stdio: "ignore", detached: true });
  child.unref();
}

/** How to re-run this program as `kiwi daemon`: the binary itself when compiled, else bun plus this CLI. */
function cliDaemonArgv(): string[] {
  const argv = [process.execPath];
  const main = process.argv[1];
  if (main && main !== "daemon" && (main.endsWith(".ts") || main.endsWith(".js"))) argv.push(main);
  argv.push("daemon");
  return argv;
}

/** The daemon's version, computer key and paired person. Refuses when none is running. */
export async function daemonHello(sock = daemonSock()): Promise<DaemonHello> {
  const hello = await tryHello(sock);
  if (!hello) throw new Error(`no daemon on ${sock} (start one with: kiwi daemon)`);
  return hello;
}

/** Hand this computer its cert (the app adopting its own daemon). Validates before storing. */
export async function adoptDaemon(cert: MachineCert, person: PairedPerson, sock = daemonSock()): Promise<void> {
  const c = await openConn(sock);
  try {
    await c.call("adopt", { cert, person });
  } finally {
    c.close();
  }
}

/** Who is subscribed to which agent. Refuses when no daemon is running. */
export async function daemonListening(sock = daemonSock()): Promise<DaemonSeat[]> {
  const c = await openConn(sock);
  try {
    const r = await c.call("listening");
    return (r.subscriptions ?? []) as DaemonSeat[];
  } finally {
    c.close();
  }
}

/** Stop the daemon. Quiet when none is running. */
export async function stopDaemon(sock = daemonSock()): Promise<void> {
  try {
    const c = await openConn(sock, 2_000);
    try {
      await c.call("stop");
    } finally {
      c.close();
    }
  } catch {
    // Already gone; stopping nothing is stopping done.
  }
  // The daemon removes its socket on the way out; wait for it, briefly.
  if (process.platform !== "win32") {
    const until = Date.now() + 5_000;
    while (existsSync(sock) && Date.now() < until) await Bun.sleep(50);
  }
}

export interface DaemonSubscription {
  readonly head: number;
  readonly channel: string;
  readonly agent: string;
  [Symbol.asyncIterator](): AsyncIterator<Message>;
  close(): void;
}

/**
 * Subscribe to an agent's messages from `cursor` on. The first listen with no live daemon starts
 * one in the background. Ends when the signal aborts, the subscription closes, or the daemon's
 * stream for this seat ends (then the iterator throws, and resubscribing from the last message's
 * seq resumes).
 */
export async function listenDaemon(
  channel: string,
  agent: string,
  cursor: number,
  opts: { sock?: string; signal?: AbortSignal; noSpawn?: boolean } = {},
): Promise<DaemonSubscription> {
  const sock = opts.sock ?? daemonSock();
  if (!opts.noSpawn) await ensureDaemon(home());
  const c = await openConn(sock);
  const queue: Message[] = [];
  let failed: Error | null = null;
  let done = false;
  let wake: (() => void) | null = null;
  const stir = (): void => {
    const w = wake;
    wake = null;
    w?.();
  };
  const onAbort = (): void => {
    done = true;
    stir();
    c.close();
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  let head = cursor;
  try {
    const r = await c.subscribe({ channel, as: agent, cursor }, (m) => {
      queue.push(m);
      stir();
    }, (err) => {
      failed = err;
      stir();
    });
    if (typeof r.head === "number") head = r.head;
  } catch (err) {
    opts.signal?.removeEventListener("abort", onAbort);
    c.close();
    throw err;
  }
  return {
    head,
    channel,
    agent,
    close: () => {
      opts.signal?.removeEventListener("abort", onAbort);
      done = true;
      stir();
      c.close();
    },
    [Symbol.asyncIterator]() {
      return {
        next: async (): Promise<IteratorResult<Message>> => {
          for (;;) {
            const m = queue.shift();
            if (m) return { value: m, done: false };
            if (failed) throw failed;
            if (done || c.closed()) return { value: undefined, done: true };
            // Synchronous check-then-wait: nothing runs between setting wake and sleeping,
            // so a delivery can't slip past.
            await new Promise<void>((resolve) => {
              wake = resolve;
              if (queue.length || failed || done || c.closed()) stir();
            });
          }
        },
      };
    },
  };
}

/** `kiwi daemon`: serve this home in the foreground until SIGTERM/SIGINT. Logs one line. */
export async function runDaemonForeground(dir = home()): Promise<void> {
  // The CLI installed early SIGTERM/SIGINT handlers before anything async (see src/cli/main.ts):
  // drop them now that this handler is in, so one signal has exactly one clean shutdown.
  (globalThis as { __kiwiDisarmEarlySignals?: () => void }).__kiwiDisarmEarlySignals?.();
  // Handlers first: a signal during startup stops a clean exit, never a kill (a supervisor that
  // kills right after spawn would otherwise win the race with the listener below).
  let sock: string | null = null;
  const goodbye = new Promise<void>((resolve) => {
    const bye = (): void => void (sock ? stopDaemon(sock) : Promise.resolve()).catch(() => {}).then(resolve, resolve);
    process.once("SIGTERM", bye);
    process.once("SIGINT", bye);
  });
  sock = daemonSock(dir);
  const live = await tryHello(sock);
  if (live && live.version === VERSION) throw new PairError(`a daemon is already running (pid ${live.pid}) on ${sock}`);
  if (live) await stopDaemon(sock); // an older daemon: stop it, start our own
  const serving = await startDaemon(dir);
  process.stdout.write(`kiwi daemon ${VERSION} on ${sock} (pid ${process.pid})\n`);
  // A socket `stop` ends the process too: background daemons, told only over the socket, must not linger.
  await Promise.race([goodbye, serving.stopped]);
  await serving.stop().catch(() => {});
}

// ---------- kiwi pair ----------

/** `kiwi pair` stopped with a line for the person (a bad code, a timeout, a refusal). */
export class PairError extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
    this.name = "PairError";
  }
}

const pairRefused = (relay: string, err: unknown): PairError => {
  if (err instanceof MailboxError && err.status === 0) return new PairError(`couldn't reach ${relay}: ${err.message}`);
  if (err instanceof MailboxError) return new PairError(`the relay refused (${err.status}): ${err.message}`);
  return new PairError(err instanceof Error ? err.message : String(err));
};

/**
 * Pair this computer with a person's app: write the signed ask to the mailbox slot the app's
 * code names, wait for its answer, check the cert is for this computer, keep it in machine.json
 * and delete the mailbox. The slot is written once, so running this again with the same code
 * while the ask stands resumes waiting on it (a second run started after the first one finished
 * pairing finds the mailbox gone and starts a fresh ask instead).
 */
export async function pairComputer(
  code: string,
  opts: { relay?: string; timeoutMs?: number; signal?: AbortSignal; onStatus?: (line: string) => void } = {},
): Promise<{ cert: MachineCert; person: PairedPerson }> {
  const secret = readPairCode((code ?? "").trim());
  if (!secret) throw new PairError("that isn't a pairing code (they look like kp1-…: the app shows it, you run kiwi pair with it)");
  const relay = (opts.relay ?? process.env.KIWI_RELAY ?? DEFAULT_RELAY).replace(/\/+$/, "");
  const say = opts.onStatus ?? ((line: string) => process.stdout.write(line + "\n"));
  const m = await ensureMachine(relay);
  const mailbox = await openMailbox(relay, secret).catch((err: unknown) => {
    throw pairRefused(relay, err);
  });
  await askToPair(m.identity, mailbox, m.label, process.platform).catch((err: unknown) => {
    // The slot is written once: a re-run finds its own ask already there and keeps waiting.
    if (err instanceof MailboxError && err.status === 409) return;
    throw pairRefused(relay, err);
  });
  say(`asked to pair "${m.label}": approve it in your app, and this waits here.`);
  const raw = await mailbox
    .wait<unknown>("b", { timeoutMs: opts.timeoutMs ?? MAILBOX_TTL_MS, everyMs: 1_500, ...(opts.signal ? { signal: opts.signal } : {}) })
    .catch((err: unknown) => {
      throw pairRefused(relay, err);
    });
  if (raw === null) throw new PairError(`nothing approved "${m.label}" in time; run the same command with a fresh code to try again`, 3);
  const answer = await readPairAnswer(raw, m.identity.pk);
  if (!answer) throw new PairError("the app's answer didn't check out (another computer, or a forged answer); approve again with a fresh code");
  const paired: PairedMachine = { ...m, cert: answer.cert, person: answer.person };
  saveMachine(paired);
  await mailbox.drop();
  say(`paired with ${answer.person.name}: this computer's cert is kept in ${join(home(), "machine.json")}.`);
  return { cert: answer.cert, person: answer.person };
}
