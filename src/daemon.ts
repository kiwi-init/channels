// kiwi daemon: one long-running process per KIWI_HOME. The app and the CLI talk to it over
// $KIWI_HOME/daemon.sock (a named pipe on Windows), newline-delimited JSON: {id, verb, ...} in,
// {id, ok, ...} out. It owns two things:
//
//   - this computer's key and cert (machine.json, re-read on every request, so `kiwi pair`
//     changing it just works), plus `adopt` for the app handing the cert to its own computer;
//   - one live relay stream per local agent seat, shared by every subscriber of that agent
//     (`listen` on this socket); each subscriber still gets its deliveries from its own cursor.
//
// The multiplex runs over client.ts's Promise API (history for catch-up, one stream() per seat),
// not over an agent session: the relay authenticates one socket as one member key, and presence
// and read marks are per agent — which is exactly why the daemon keeps one stream per seat and
// shares it. A CLI that finds an older daemon stops it and starts its own.
// `kiwi pair` (below) pairs the computer through the relay's pairing mailbox.

import { spawn } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Socket, Subprocess } from "bun";
// The channel stack (client.ts) loads lazily in seatFor, where the multiplex needs it: pairing,
// hello/adopt and the socket itself never touch it, so `kiwi pair` works without it.
import type { Channel, PresenceFields } from "./client.ts";
import type { Activity, Message, Reach } from "./protocol.ts";
import { DEFAULT_RELAY, hasKiwiState, home, identitiesIn, loadConfig, loadIdentity, saveAccess, type Config, type SeatRecord } from "./config.ts";
import { withExchangeKey } from "./identity.ts";
import { loadMachine, newMachine, saveMachine, type MachineFile } from "./machine.ts";
import { MAILBOX_TTL_MS, MailboxError, askToPair, openMailbox, readPairAnswer, readPairCode } from "./mailbox.ts";
import { readMachineCert, type MachineCert } from "./person.ts";
import { pidAlive } from "./seats.ts";
import { VERSION } from "./version.ts";
import { viaOf, wakeArgv, wakeKey, wakePath, wakePrompt, type WakeCommand, type WakePath, type WakeVia } from "./wake.ts";

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

export type DaemonVerb = "hello" | "adopt" | "listen" | "listening" | "hold" | "listeners" | "read" | "mark" | "stop";

export const DAEMON_PROTOCOL = 4;

export type DaemonEvent = "open" | "roster" | "info" | "request";

export interface DaemonHello {
  version: string;
  protocol: number;
  pid: number;
  machine: string | null;
  mxpk: string | null;
  label: string | null;
  relay: string | null;
  person: PairedPerson | null;
  certified: boolean;
}

export interface DaemonRead {
  at: number;
  session: string | null;
}

export interface DaemonWake {
  at: number;
  via: WakeCommand;
  unread: number;
  ok: boolean;
}

export type ListenerKind = "listen" | "hook" | "session";

export interface DaemonListener {
  channel: string;
  agent: string;
  kind: ListenerKind;
  cwd: string | null;
  harness: string | null;
  session: string | null;
  pid: number | null;
  at: number;
}

const optionalText = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function readListener(x: unknown): DaemonListener | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const channel = optionalText(r.channel);
  const agent = optionalText(r.agent ?? r.as);
  if (!channel || !agent || (r.kind !== "listen" && r.kind !== "hook" && r.kind !== "session")) return null;
  return {
    channel,
    agent,
    kind: r.kind,
    cwd: optionalText(r.cwd),
    harness: optionalText(r.harness),
    session: optionalText(r.session),
    pid: typeof r.pid === "number" && Number.isInteger(r.pid) && r.pid > 0 ? r.pid : null,
    at: typeof r.at === "number" ? r.at : Date.now(),
  };
}

export interface DaemonSeat {
  channel: string;
  agent: string;
  subscribers: number;
  read: DaemonRead | null;
  wake: { on: boolean; path: WakePath; last: DaemonWake | null };
  reach: Reach | null;
}

interface Seat {
  key: string;
  alias: string;
  agent: string;
  ch: Channel;
  ctl: AbortController;
  subs: Set<Sub>;
  head: number;
  activity: Activity | undefined;
  reach: Reach | null;
  activityTimer: ReturnType<typeof setInterval> | null;
  announce: (() => void) | null;
  beacon: ReturnType<typeof setInterval> | null;
  lastProbe: number;
  mark: ((seq: number) => boolean) | null;
  marked: number;
  wantMark: number;
  lastMarkAt: number;
  markTimer: ReturnType<typeof setTimeout> | null;
  wakeVia: WakeVia | null;
  wakeTimer: ReturnType<typeof setTimeout> | null;
  waking: boolean;
  wakeAgain: boolean;
  wakeChild: Subprocess | null;
  lastWake: DaemonWake | null;
}

type Env = Record<string, string | undefined>;

const HARNESS_ENV = ["CLAUDECODE", "CLAUDE_PID", "CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID", "OPENCODE_SESSION_ID", "GROK_SESSION_ID", "GEMINI_CLI", "CURSOR_AGENT", "MIMOCODE", "MIMOCODE_PID"] as const;

export const ACTIVITY_EVERY_MS = 3_000;
const PROBE_ANSWER_GAP_MS = 500;
const TICK_MS = 5_000;
const RETRY_FIRST_MS = 5_000;
const RETRY_MAX_MS = 30 * 60_000;

class NotAgentSeat extends Error {}

export function seatRecordFor(cfg: Config, alias: string, agent: string): SeatRecord | null {
  const records = Object.values(cfg.bindings ?? {}).flatMap((v) => (Array.isArray(v) ? v : [v]));
  const mine = records.filter((r) => r.alias === alias && r.as === agent);
  const when = (r: SeatRecord): number => r.seen ?? r.at ?? 0;
  return mine.reduce<SeatRecord | null>((best, r) => (!best || when(r) > when(best) ? r : best), null);
}

export function activityEnv(record: SeatRecord, base: Env): Env | null {
  const env: Env = { ...base };
  for (const k of HARNESS_ENV) delete env[k];
  const session = record.session;
  switch (record.harness) {
    case "claude":
      return record.pid ? { ...env, CLAUDECODE: "1", CLAUDE_PID: String(record.pid), ...(session ? { CLAUDE_CODE_SESSION_ID: session } : {}) } : null;
    case "codex":
      return session ? { ...env, CODEX_THREAD_ID: session } : null;
    case "opencode":
      return session ? { ...env, OPENCODE_SESSION_ID: session } : null;
    case "grok":
      return session ? { ...env, GROK_SESSION_ID: session } : null;
    case "gemini":
    case "cursor":
    case "kimi":
    case "mimo":
    case undefined:
      return null;
  }
}

export type Attached = "listener" | "session" | "none";

export function reachOf(attached: Attached, record: SeatRecord | null, activity: Activity | undefined, alive: (pid: number) => boolean = pidAlive): Reach {
  if (attached === "listener") return "listening";
  if (attached === "session") return "running";
  if (record?.pid) return alive(record.pid) ? "running" : "unreachable";
  return record?.harness === "grok" && activity?.state === "working" ? "running" : "unreachable";
}

const readKey = (alias: string, agent: string): string => `${alias}\u0000${agent}`;

interface Sub {
  id: number;
  cursor: number;
  conn: ConnState;
  seat: Seat;
}

interface Waiting {
  tell: (status: string) => void;
  alive: () => boolean;
}

interface ConnState {
  socket: Socket;
  decoder: TextDecoder;
  buf: string;
  subs: Set<Sub>;
  held: Set<DaemonListener>;
  dead: boolean;
}

export interface Daemon {
  readonly sock: string;
  stop(): Promise<void>;
  /** Resolves when the daemon stops, however it was told (socket `stop`, `stop()`, a crash of the server). */
  readonly stopped: Promise<void>;
  beacons(): number;
}

export interface DaemonOptions {
  beaconMs?: number;
  wakeDelayMs?: number;
  wakeGapMs?: number;
}

const WAKE_DELAY_MS = 2_000;
const WAKE_GAP_MS = 60_000;
const WAKE_RUN_MS = 60_000;
const UNREAD_CHECK_MS = 30_000;

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
  });
  return Promise.race([work, late]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function wakeOn(cfg: Config, alias: string, agent: string): boolean {
  return !(cfg.wakeOff ?? []).includes(wakeKey(alias, agent));
}

/** Serve this home's daemon (used by `kiwi daemon`, and by tests in-process). Refuses when one already answers. */
export async function startDaemon(dir = home(), opts: DaemonOptions = {}): Promise<Daemon> {
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
  const opening = new Map<string, { promise: Promise<Seat>; waiters: Set<Waiting>; last: () => string | null }>();
  let beacons = 0;
  const reads = new Map<string, DaemonRead>();
  const retries = new Map<string, { at: number; delay: number; fp: string }>();
  const people = new Set<string>();
  const keeper: Waiting = { tell: () => {}, alive: () => !stopped };

  const fingerprintOf = (key: string, alias: string): string => `${key}\u0000${JSON.stringify(loadConfig().channels[alias] ?? null)}`;

  const backoff = (key: string, fp: string): void => {
    const prev = retries.get(key);
    const delay = prev ? Math.min(prev.delay * 2, RETRY_MAX_MS) : RETRY_FIRST_MS;
    retries.set(key, { at: Date.now() + delay, delay, fp });
  };

  const stillWanted = (alias: string, roomId: string, agent: string): boolean => {
    const now = loadConfig().channels[alias];
    return !!now && now.roomId === roomId && identitiesIn(roomId).includes(agent);
  };

  const fieldsOf = (seat: Seat): PresenceFields => {
    const read = reads.get(readKey(seat.alias, seat.agent));
    return { client: "daemon", ...(seat.activity ? { activity: seat.activity } : {}), ...(seat.reach ? { reach: seat.reach } : {}), ...(read ? { readAt: read.at } : {}), ...(seat.wakeVia ? { wake: seat.wakeVia } : {}) };
  };

  const pathOf = async (cfg: Config, alias: string, agent: string): Promise<WakePath> => {
    const { listenHooksInstalled } = await import("./hooks.ts");
    return wakePath(seatRecordFor(cfg, alias, agent), listenHooksInstalled());
  };

  const attachedTo = (seat: Seat): Attached => {
    const held = [...conns].filter((c) => !c.dead).flatMap((c) => [...c.held].filter((l) => l.channel === seat.alias && l.agent === seat.agent));
    if (seat.subs.size > 0 || held.some((l) => l.kind !== "session")) return "listener";
    return held.length ? "session" : "none";
  };

  const refreshActivity = async (seat: Seat, force = false): Promise<void> => {
    const cfg = loadConfig();
    const record = seatRecordFor(cfg, seat.alias, seat.agent);
    const env = record ? activityEnv(record, process.env) : null;
    const { harnessActivity } = await import("./harness.ts");
    const now = env ? await harnessActivity(env) : undefined;
    const via = wakeOn(cfg, seat.alias, seat.agent) ? viaOf(await pathOf(cfg, seat.alias, seat.agent)) : null;
    const reach = reachOf(attachedTo(seat), record, now);
    if (!force && JSON.stringify(now) === JSON.stringify(seat.activity) && via === seat.wakeVia && reach === seat.reach) return;
    seat.activity = now;
    seat.wakeVia = via;
    seat.reach = reach;
    seat.announce?.();
  };

  const wakeDelayMs = opts.wakeDelayMs ?? WAKE_DELAY_MS;
  const wakeGapMs = opts.wakeGapMs ?? WAKE_GAP_MS;

  const unreadFor = async (seat: Seat): Promise<number> => {
    const c = loadConfig().channels[seat.alias];
    if (!c) return 0;
    const { AgentSession, runAgent } = await import("./agent.ts");
    const s = await AgentSession.open(seat.alias, c, seat.agent);
    const { messages, state } = await runAgent(s.state());
    return runAgent(s.unreadCount(state, messages));
  };

  const runWake = async (seat: Seat, [cmd, ...rest]: string[]): Promise<boolean> => {
    const exe = cmd ? Bun.which(cmd, { PATH: process.env.PATH ?? "" }) : null;
    if (!exe) return false;
    try {
      const child = Bun.spawn([exe, ...rest], { env: { ...process.env }, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
      seat.wakeChild = child;
      const timer = setTimeout(() => child.kill(), WAKE_RUN_MS);
      const code = await child.exited;
      clearTimeout(timer);
      if (seat.wakeChild === child) seat.wakeChild = null;
      return code === 0;
    } catch {
      return false;
    }
  };

  const logWake = (seat: Seat, w: DaemonWake): void => {
    try {
      appendFileSync(join(dir, "wake.log"), `${new Date(w.at).toISOString()}\t${seat.alias}\t${seat.agent}\t${w.via}\t${w.unread}\t${w.ok ? "ok" : "failed"}\n`, { mode: 0o600 });
    } catch {
      return;
    }
  };

  const scheduleWake = (seat: Seat, delay = wakeDelayMs): void => {
    if (seat.wakeTimer || stopped) return;
    seat.wakeTimer = setTimeout(() => {
      seat.wakeTimer = null;
      void fireWake(seat).catch(() => {});
    }, delay);
  };

  const current = (seat: Seat): boolean => !stopped && seats.get(seat.key) === seat;

  const commandPath = async (seat: Seat): Promise<Extract<WakePath, { kind: "command" }> | null> => {
    const cfg = loadConfig();
    if (!wakeOn(cfg, seat.alias, seat.agent)) return null;
    const path = await pathOf(cfg, seat.alias, seat.agent);
    return path.kind === "command" ? path : null;
  };

  const fireWake = async (seat: Seat): Promise<void> => {
    if (!current(seat)) return;
    if (seat.waking) {
      seat.wakeAgain = true;
      return;
    }
    if (!(await commandPath(seat))) return;
    const since = Date.now() - (seat.lastWake?.at ?? 0);
    if (since < wakeGapMs) return scheduleWake(seat, wakeGapMs - since);
    seat.waking = true;
    try {
      const unread = await withDeadline(unreadFor(seat), UNREAD_CHECK_MS).catch(() => null);
      if (unread === null) {
        seat.wakeAgain = false;
        return scheduleWake(seat, wakeGapMs);
      }
      if (!unread || !current(seat)) return;
      const path = await commandPath(seat);
      if (!path || !current(seat)) return;
      const ok = await runWake(seat, wakeArgv(path.via, path.session, wakePrompt(seat.alias, seat.agent)));
      if (!current(seat)) return;
      seat.lastWake = { at: Date.now(), via: path.via, unread, ok };
      logWake(seat, seat.lastWake);
    } finally {
      seat.waking = false;
      if (seat.wakeAgain && current(seat)) {
        seat.wakeAgain = false;
        scheduleWake(seat);
      }
    }
  };

  const seatInfo = async (s: Seat): Promise<DaemonSeat> => {
    const cfg = loadConfig();
    return {
      channel: s.alias,
      agent: s.agent,
      subscribers: s.subs.size,
      read: reads.get(readKey(s.alias, s.agent)) ?? null,
      wake: { on: wakeOn(cfg, s.alias, s.agent), path: await pathOf(cfg, s.alias, s.agent), last: s.lastWake },
      reach: s.reach,
    };
  };

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

  const stopBeacon = (seat: Seat): void => {
    if (!seat.beacon) return;
    clearInterval(seat.beacon);
    seat.beacon = null;
    beacons--;
  };

  const endSeat = (seat: Seat): void => {
    seat.ctl.abort();
    stopBeacon(seat);
    if (seat.markTimer) clearTimeout(seat.markTimer);
    if (seat.activityTimer) clearInterval(seat.activityTimer);
    if (seat.wakeTimer) clearTimeout(seat.wakeTimer);
    seat.wakeChild?.kill();
    seat.activityTimer = null;
    seat.wakeTimer = null;
    seat.wakeChild = null;
    seat.beacon = null;
    seat.markTimer = null;
    seat.announce = null;
    seat.mark = null;
  };

  const tell = (seat: Seat, line: { event: DaemonEvent } | { status: string }): void => {
    for (const sub of [...seat.subs]) sendLine(sub.conn, JSON.stringify({ id: sub.id, ...line }));
  };

  const flushMark = (seat: Seat): void => {
    if (seat.markTimer || seat.wantMark <= seat.marked || !seat.mark) return;
    const wait = seat.lastMarkAt + 1_000 - Date.now();
    if (wait > 0) {
      seat.markTimer = setTimeout(() => {
        seat.markTimer = null;
        flushMark(seat);
      }, wait);
      return;
    }
    const seq = seat.wantMark;
    if (seat.mark(seq)) {
      seat.marked = seq;
      seat.lastMarkAt = Date.now();
    }
  };

  const reachMoved = (alias: string, agent: string): void => {
    for (const seat of seats.values()) if (seat.alias === alias && seat.agent === agent && seat.announce) void refreshActivity(seat).catch(() => {});
  };

  const killConn = (conn: ConnState): void => {
    if (conn.dead) return;
    conn.dead = true;
    conns.delete(conn);
    for (const sub of [...conn.subs]) dropSub(sub);
    for (const l of conn.held) reachMoved(l.channel, l.agent);
  };

  const dropSub = (sub: Sub): void => {
    sub.conn.subs.delete(sub);
    sub.seat.subs.delete(sub);
    reachMoved(sub.seat.alias, sub.seat.agent);
  };

  const closeSeat = (seat: Seat, error: string): void => {
    if (seats.get(seat.key) === seat) seats.delete(seat.key);
    endSeat(seat);
    for (const sub of [...seat.subs]) {
      sendLine(sub.conn, JSON.stringify({ id: sub.id, ok: false, error }));
      dropSub(sub);
    }
  };

  const seatEnded = (seat: Seat, err: unknown): void => {
    if (seats.get(seat.key) !== seat) return;
    if (err === null) {
      seats.delete(seat.key);
      endSeat(seat);
      return;
    }
    closeSeat(seat, `the channel stream ended: ${why(err)}`);
    backoff(seat.key, fingerprintOf(seat.key, seat.alias));
  };

  const beaconMs = opts.beaconMs ?? 60_000;

  const firstHead = async (ch: Channel, waiting: Waiting): Promise<number> => {
    const { ChannelGone, RelayError } = await import("./client.ts");
    const answered = (err: unknown): boolean => err instanceof ChannelGone || (err instanceof RelayError && err.status < 500 && err.status !== 429);
    const since = Date.now();
    let told = false;
    for (let backoff = 500; ; backoff = Math.min(backoff * 2, 30_000)) {
      try {
        const head = await ch.head();
        if (told) waiting.tell(`reached the relay after ${Math.round((Date.now() - since) / 1000)}s`);
        return head;
      } catch (err) {
        if (err instanceof ChannelGone) throw err;
        if (answered(err) || stopped || !waiting.alive()) throw new Error(why(err));
        if (!told) {
          told = true;
          waiting.tell(`can't reach the relay (${why(err)}); still retrying`);
        }
        const until = Date.now() + backoff;
        while (Date.now() < until) {
          if (stopped || !waiting.alive()) throw new Error(why(err));
          await Bun.sleep(Math.min(250, until - Date.now()));
        }
      }
    }
  };

  const opened = (seat: Seat, presence: (p: PresenceFields) => Promise<void>, mark: (seq: number) => boolean): void => {
    if (seats.get(seat.key) !== seat || seat.ctl.signal.aborted) return;
    seat.mark = mark;
    seat.announce = () => void presence(fieldsOf(seat)).catch(() => {});
    void refreshActivity(seat, true).catch(() => seat.announce?.());
    stopBeacon(seat);
    seat.beacon = setInterval(() => seat.announce?.(), beaconMs);
    beacons++;
    if (!seat.activityTimer) seat.activityTimer = setInterval(() => void refreshActivity(seat).catch(() => {}), ACTIVITY_EVERY_MS);
    seat.marked = 0;
    flushMark(seat);
    tell(seat, { event: "open" });
  };

  const seatFor = async (alias: string, agent: string, waiting: Waiting): Promise<Seat> => {
    const cfg = loadConfig();
    const c = cfg.channels[alias];
    if (!c) throw new Error(`unknown channel "${alias}" on this computer (see: kiwi channels)`);
    if (!identitiesIn(c.roomId).includes(agent)) throw new Error(`no key for agent "${agent}" in "${alias}" on this computer (join first)`);
    const id = await loadIdentity(agent, c.roomId);
    const key = `${c.roomId}/${id.pk}`;
    const hit = seats.get(key);
    if (hit) return hit;
    const inflight = opening.get(key);
    if (inflight) {
      inflight.waiters.add(waiting);
      const said = inflight.last();
      if (said) waiting.tell(said);
      return inflight.promise;
    }
    const waiters = new Set<Waiting>([waiting]);
    let last: string | null = null;
    const anyone: Waiting = {
      tell: (s) => {
        last = s;
        for (const w of waiters) if (w.alive()) w.tell(s);
      },
      alive: () => [...waiters].some((w) => w.alive()),
    };
    const open = (async (): Promise<Seat> => {
      const { Channel } = await import("./client.ts");
      const ch = new Channel(c, c.relay, id, (a) => saveAccess(alias, a));
      const head = await firstHead(ch, anyone);
      if (stopped) throw new Error("the daemon is stopping");
      if (!anyone.alive()) throw new Error("nobody is waiting for this channel any more");
      if (!stillWanted(alias, c.roomId, agent)) throw new Error(`"${agent}" no longer has a key in "${alias}" on this computer`);
      const self = (await ch.members()).find((m) => m.pk === id.pk);
      if (!self || self.owner || self.kind === "human") throw new NotAgentSeat(`"${agent}" isn't an agent in "${alias}": the daemon holds seats for agents only`);
      if (stopped) throw new Error("the daemon is stopping");
      const seat: Seat = {
        key,
        alias,
        agent,
        ch,
        ctl: new AbortController(),
        subs: new Set(),
        head,
        activity: undefined,
        reach: null,
        activityTimer: null,
        announce: null,
        beacon: null,
        lastProbe: 0,
        mark: null,
        marked: 0,
        wantMark: 0,
        lastMarkAt: 0,
        markTimer: null,
        wakeVia: null,
        wakeTimer: null,
        waking: false,
        wakeAgain: false,
        wakeChild: null,
        lastWake: null,
      };
      seats.set(key, seat);
      // stop() may have run between the check and the set: don't leave a stream behind it.
      if (stopped) {
        seats.delete(key);
        endSeat(seat);
        throw new Error("the daemon is stopping");
      }
      ch.stream(
        seat.head,
        (m) => {
          if (m.seq > seat.head) seat.head = m.seq;
          if (m.from !== seat.agent) scheduleWake(seat);
          for (const sub of [...seat.subs]) {
            if (m.seq <= sub.cursor) continue;
            if (sendLine(sub.conn, JSON.stringify({ id: sub.id, message: m }))) sub.cursor = m.seq;
          }
        },
        {
          signal: seat.ctl.signal,
          onOpen: ({ presence, mark }) => opened(seat, presence, mark),
          onPresence: (p) => {
            if (!p.query || Date.now() - seat.lastProbe < PROBE_ANSWER_GAP_MS) return;
            seat.lastProbe = Date.now();
            seat.announce?.();
          },
          onRoster: () => tell(seat, { event: "roster" }),
          onInfo: () => tell(seat, { event: "info" }),
          onRequest: () => tell(seat, { event: "request" }),
          onStatus: (s) => tell(seat, { status: s }),
        },
      ).then(
        () => seatEnded(seat, null),
        (err: unknown) => seatEnded(seat, seat.ctl.signal.aborted ? null : err),
      );
      return seat;
    })();
    const entry = { promise: open, waiters, last: () => last };
    opening.set(key, entry);
    try {
      return await open;
    } finally {
      if (opening.get(key) === entry) opening.delete(key);
    }
  };

  const onListen = async (conn: ConnState, id: number, params: Record<string, unknown>): Promise<void> => {
    const { channel, as, cursor } = params as { channel?: unknown; as?: unknown; cursor?: unknown };
    if (typeof channel !== "string" || !channel || typeof as !== "string" || !as) throw new Error('listen needs {"channel", "as", cursor}');
    if (typeof cursor !== "number" || !Number.isInteger(cursor) || cursor < 0) throw new Error("listen needs a cursor: the last sequence number this subscriber saw (0 for everything)");
    // The seat's stream is already running before the catch-up below, so the two overlap and
    // never gap; the cursor dedupes the overlap.
    const seat = await seatFor(channel, as, { tell: (s) => sendLine(conn, JSON.stringify({ id, status: s })), alive: () => !conn.dead });
    if (conn.dead || stopped) return;
    const sub: Sub = { id, cursor, conn, seat };
    seat.subs.add(sub);
    conn.subs.add(sub);
    reachMoved(seat.alias, seat.agent);
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

  const seatNamed = (params: Record<string, unknown>): Seat => {
    const { channel, as } = params;
    const seat = [...seats.values()].find((s) => s.alias === channel && s.agent === as);
    if (!seat) throw new Error(`this daemon holds no seat for "${String(as)}" in "${String(channel)}"`);
    return seat;
  };

  const syncSeats = async (): Promise<void> => {
    if (stopped) return;
    let cfg: Config;
    try {
      cfg = loadConfig();
    } catch {
      return;
    }
    const wanted = new Set<string>();
    for (const [alias, c] of Object.entries(cfg.channels)) {
      for (const agent of identitiesIn(c.roomId)) {
        const id = await loadIdentity(agent, c.roomId).catch(() => null);
        if (!id || stopped || id.pk === c.ownerPk) continue;
        const key = `${c.roomId}/${id.pk}`;
        wanted.add(key);
        if (seats.has(key) || opening.has(key) || people.has(key)) continue;
        const fp = `${key}\u0000${JSON.stringify(c)}`;
        const retry = retries.get(key);
        if (retry && retry.fp === fp && Date.now() < retry.at) continue;
        void seatFor(alias, agent, keeper).then(
          () => void retries.delete(key),
          (err: unknown) => {
            if (err instanceof NotAgentSeat) people.add(key);
            else if (!stopped) backoff(key, fp);
          },
        );
      }
    }
    for (const seat of [...seats.values()]) {
      if (!wanted.has(seat.key)) closeSeat(seat, `"${seat.agent}" no longer has a key in "${seat.alias}" on this computer`);
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
    void syncSeats();
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
              protocol: DAEMON_PROTOCOL,
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
        case "read": {
          const { channel, as, session } = params;
          if (typeof channel !== "string" || !channel || typeof as !== "string" || !as) throw new Error('read needs {"channel", "as", "session"?}');
          reads.set(readKey(channel, as), { at: Date.now(), session: typeof session === "string" && session ? session : null });
          [...seats.values()].find((s) => s.alias === channel && s.agent === as)?.announce?.();
          sendLine(conn, JSON.stringify({ id, ok: true }));
          break;
        }
        case "mark": {
          const seat = seatNamed(params);
          const { seq } = params;
          if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) throw new Error('mark needs {"channel", "as", "seq"}');
          if (seq > seat.wantMark) seat.wantMark = seq;
          flushMark(seat);
          sendLine(conn, JSON.stringify({ id, ok: true }));
          break;
        }
        case "listening":
          sendLine(
            conn,
            JSON.stringify({
              id,
              ok: true,
              subscriptions: await Promise.all([...seats.values()].map(seatInfo)),
            }),
          );
          break;
        case "hold": {
          const l = readListener({ ...params, at: Date.now() });
          if (!l) throw new Error('hold needs {"channel", "as", "kind": "listen" or "hook", "cwd"?, "harness"?, "session"?, "pid"?}');
          const others = [...conns].filter((c) => c !== conn && !c.dead).flatMap((c) => [...c.held]);
          const taken = l.kind === "hook" && others.some((h) => h.kind === "hook" && h.channel === l.channel && h.agent === l.agent && h.session === l.session);
          if (!taken) {
            conn.held.add(l);
            reachMoved(l.channel, l.agent);
          }
          sendLine(conn, JSON.stringify({ id, ok: true, held: !taken }));
          break;
        }
        case "listeners":
          sendLine(conn, JSON.stringify({ id, ok: true, listeners: [...conns].filter((c) => !c.dead).flatMap((c) => [...c.held]) }));
          break;
        case "stop":
          sendLine(conn, JSON.stringify({ id, ok: true }));
          // After the reply flushes.
          setTimeout(() => void stop(), 50);
          break;
        default:
          throw new Error(`unknown verb "${verb}" (hello, adopt, listen, listening, hold, listeners, read, mark, stop)`);
      }
    } catch (err) {
      sendLine(conn, JSON.stringify({ id, ok: false, error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const server = Bun.listen({
    unix: sock,
    socket: {
      open(socket) {
        conns.add({ socket: socket as Socket, decoder: new TextDecoder(), buf: "", subs: new Set(), held: new Set(), dead: false });
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

  const tick = setInterval(() => {
    if (!existsSync(dir)) void stop();
    else void syncSeats();
  }, TICK_MS);

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    clearInterval(tick);
    resolveStopped();
    for (const conn of [...conns]) {
      try {
        conn.socket.end();
      } catch {
        // Already gone; killConn below still reaps it.
      }
      killConn(conn);
    }
    for (const seat of seats.values()) endSeat(seat);
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

  await syncSeats();
  return { sock, stop, stopped: stoppedP, beacons: () => beacons };
}

// ---------- talking to the daemon ----------

type Reply = { id: number; ok: true; [k: string]: unknown } | { id: number; ok: false; error: string };

interface DaemonConn {
  call(verb: string, params?: Record<string, unknown>): Promise<Extract<Reply, { ok: true }>>;
  subscribe(
    params: Record<string, unknown>,
    onMessage: (m: Message) => void,
    onError: (err: Error) => void,
    side?: SideLines,
  ): Promise<Extract<Reply, { ok: true }>>;
  closed(): boolean;
  close(): void;
}

interface SideLines {
  onEvent?: (e: DaemonEvent) => void;
  onStatus?: (s: string) => void;
}

interface Pending extends SideLines {
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
          if (typeof msg.event === "string") {
            if (isDaemonEvent(msg.event)) p.onEvent?.(msg.event);
            continue;
          }
          if (typeof msg.status === "string") {
            p.onStatus?.(msg.status);
            continue;
          }
          if (p.onMessage) {
            if (!msg.ok) {
              pending.delete(msg.id);
              const err = new Error(typeof msg.error === "string" ? msg.error : "the daemon refused");
              if (p.live) p.onError?.(err);
              else p.reject(err);
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
      onEvent: entry.onEvent,
      onStatus: entry.onStatus,
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
    subscribe: (params, onMessage, onError, side = {}) =>
      new Promise<Extract<Reply, { ok: true }>>((resolve, reject) => {
        send({ verb: "listen", ...params }, { resolve: resolve as (r: Reply) => void, reject, onMessage, onError, ...side });
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
        protocol: typeof r.protocol === "number" ? r.protocol : 1,
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
  const current = (h: DaemonHello | null): h is DaemonHello => !!h && h.version === VERSION && h.protocol >= DAEMON_PROTOCOL;
  const live = await tryHello(sock);
  if (current(live)) return live;
  if (live) await stopDaemon(sock);
  spawnDaemon(dir, argv);
  const until = Date.now() + 15_000;
  for (;;) {
    const hello = await tryHello(sock);
    if (current(hello)) return hello;
    if (Date.now() > until) throw new Error(`kiwi daemon didn't answer on ${sock}`);
    await Bun.sleep(100);
  }
}

/** Start `kiwi daemon` for `dir` in the background, detached from this process. */
export function spawnDaemon(dir = home(), argv?: string[]): void {
  const cmd = argv ?? cliDaemonArgv();
  const abs = resolve(dir);
  const child = spawn(cmd[0]!, cmd.slice(1), { cwd: abs, env: { ...process.env, KIWI_HOME: abs }, stdio: "ignore", detached: true });
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

export async function daemonListeners(sock = daemonSock()): Promise<DaemonListener[]> {
  const c = await openConn(sock, 2_000);
  try {
    const r = await c.call("listeners");
    return (Array.isArray(r.listeners) ? r.listeners : []).map(readListener).filter((l): l is DaemonListener => !!l);
  } finally {
    c.close();
  }
}

export interface HeldListener {
  readonly held: boolean | null;
  close(): void;
}

export async function holdListener(entry: Omit<DaemonListener, "at">, sock = daemonSock(), retryMs = 2_000): Promise<HeldListener> {
  let conn: DaemonConn | null = null;
  let ended = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const attempt = async (): Promise<boolean | null> => {
    try {
      const c = await openConn(sock, 2_000);
      const r = await c.call("hold", { ...entry, as: entry.agent });
      if (ended || r.held !== true) {
        c.close();
        return ended ? null : false;
      }
      conn = c;
      return true;
    } catch {
      return null;
    }
  };
  const watch = (): void => {
    timer = setTimeout(() => {
      if (ended) return;
      const again = conn && !conn.closed() ? Promise.resolve(true) : attempt();
      void again.then(() => {
        if (!ended) watch();
      });
    }, retryMs);
    timer.unref?.();
  };
  const held = await attempt();
  if (held !== false) watch();
  return {
    held,
    close: () => {
      ended = true;
      if (timer) clearTimeout(timer);
      conn?.close();
      conn = null;
    },
  };
}

export async function daemonSeat(channel: string, agent: string, sock = daemonSock()): Promise<DaemonSeat | null> {
  try {
    return (await daemonListening(sock)).find((s) => s.channel === channel && s.agent === agent) ?? null;
  } catch {
    return null;
  }
}

export async function reportRead(channel: string, agent: string, session: string | undefined, sock = daemonSock()): Promise<void> {
  try {
    const c = await openConn(sock, 2_000);
    try {
      await c.call("read", { channel, as: agent, ...(session ? { session } : {}) });
    } finally {
      c.close();
    }
  } catch {
    return;
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

const DAEMON_EVENTS: readonly DaemonEvent[] = ["open", "roster", "info", "request"];
const isDaemonEvent = (e: string): e is DaemonEvent => (DAEMON_EVENTS as readonly string[]).includes(e);

export interface DaemonSubscription {
  readonly head: number;
  readonly channel: string;
  readonly agent: string;
  [Symbol.asyncIterator](): AsyncIterator<Message>;
  close(): void;
  mark(seq: number): Promise<void>;
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
  opts: { sock?: string; signal?: AbortSignal; noSpawn?: boolean } & SideLines = {},
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
    const r = await c.subscribe(
      { channel, as: agent, cursor },
      (m) => {
        queue.push(m);
        stir();
      },
      (err) => {
        failed = err;
        stir();
      },
      { onEvent: opts.onEvent, onStatus: opts.onStatus },
    );
    if (typeof r.head === "number") head = r.head;
  } catch (err) {
    opts.signal?.removeEventListener("abort", onAbort);
    c.close();
    throw err;
  }
  const close = (): void => {
    opts.signal?.removeEventListener("abort", onAbort);
    done = true;
    stir();
    c.close();
  };
  return {
    head,
    channel,
    agent,
    close,
    mark: async (seq) => void (await c.call("mark", { channel, as: agent, seq })),
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
        return: async (): Promise<IteratorResult<Message>> => {
          close();
          return { value: undefined, done: true };
        },
        throw: async (err?: unknown): Promise<IteratorResult<Message>> => {
          close();
          throw err instanceof Error ? err : new Error(err == null ? "the listen was aborted" : String(err));
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
