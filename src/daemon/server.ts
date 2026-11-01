import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { getRandomValues, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Socket } from "bun";
import type { Channel, PresenceFields, Probe } from "@kiwi/core/client.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { DEFAULT_RELAY, hasKiwiState, home, identitiesIn, loadConfig, loadIdentity, saveAccess, writePrivate, type Config } from "../config.ts";
import { readCursor } from "../config/cursors.ts";
import { saveMachine, takeDeviceList } from "../machine.ts";
import { listedComputer, readDeviceList, type DeviceLink } from "@kiwi/core/devices.ts";
import { readMachineCert } from "@kiwi/core/person.ts";
import { VERSION } from "../version.ts";
import { compareVersions } from "@kiwi/core/versions.ts";
import { listenedPath, pullsWake, viaOf } from "@kiwi/core/wake.ts";
import { ensureMachine, loadPairedMachine, PairError, type PairedMachine, type PairedPerson } from "./pair.ts";
import { DAEMON_PROTOCOL, daemonSock, daemonToken, readListener, type DaemonEvent, type DaemonRead, type DaemonSeat, type DaemonVerb } from "./protocol.ts";
import { activityEnv, reachOf, readsRex, seatRecordFor, wakeOn, type Attached } from "./reach.ts";
import { readRexInto } from "./rex-reads.ts";
import type { RexActivity, RexPlace, SeatPlace, TerminalPlugin } from "../terminals/plugin.ts";
import { helpersOn, marking, remoteBypassOn, terminalPlugin } from "../terminals/registry.ts";
import { pruneHookFiles } from "../hooks/delivered.ts";
import { launchFolders, remoteFolders, seatFolders } from "../launch/folders.ts";
import { hooksRows } from "../hooks/install/extra.ts";
import { computerSettings } from "./settings.ts";
import { harnessInventory } from "../launch/harnesses.ts";
import { HostedTmux } from "./hosted-tmux.ts";
import { clampSize, isPane, openTerm, TERM_COLS, TERM_ROWS } from "./hosted-term.ts";
import { forgetAtRelay, startMachineInbox } from "./inbox.ts";
import { remoteRunner } from "./remote.ts";
import { launchAgent } from "../launch/launch.ts";
import { readLoopStart, startLoop } from "../loop/start.ts";
import { readLaunchRequest } from "../launch/wire.ts";
import { beatLock, dropLock, lockPath, ownsLock, takeLock } from "./lock.ts";
import { stopDaemon, tryHello } from "./rpc.ts";
import { readKey, type ConnState, type Seat, type Sub, type Waiting } from "./seat.ts";
import { throttled } from "./throttle.ts";
import { readAdmitRoom, startAdmitter } from "./admit.ts";
import { pathOf, seatWakes } from "./wake.ts";

export const ACTIVITY_EVERY_MS = 3_000;
const PROBE_ANSWER_GAP_MS = 500;
const PEEK_PROBE_MS = 250;
const MAX_QUEUED_BYTES = 64 * 1024 * 1024;
const lineEncoder = new TextEncoder();
const TICK_MS = 5_000;
const PRUNE_EVERY_MS = 24 * 3600_000;
const HOOK_FILES_KEEP_MS = 7 * 24 * 3600_000;
const ORPHAN_MS = 10 * 60_000;
const RETRY_FIRST_MS = 5_000;
const RETRY_MAX_MS = 30 * 60_000;
const SYNC_ON_REQUEST_MS = 2_000;

class NotAgentSeat extends Error {}

const NO_SOCKET_BYPASS = "a bypass agent needs kiwi launches bypass on here first (the app's Allow bypass from your other devices setting)";

export interface Daemon {
  readonly sock: string;
  stop(): Promise<void>;
  readonly stopped: Promise<void>;
  readonly hosted: HostedTmux;
  beacons(): number;
  admitting(): number;
}

export interface DaemonOptions {
  beaconMs?: number;
  wakeDelayMs?: number;
  wakeGapMs?: number;
  tickMs?: number;
  orphanMs?: number;
  wakeOutstandingMs?: number;
  listenerGraceMs?: number;
  retryFirstMs?: number;
}

const WAKE_DELAY_MS = 2_000;
const WAKE_GAP_MS = 60_000;
const WAKE_OUTSTANDING_MS = 10 * 60_000;
const LISTENER_GRACE_MS = 60_000;

export async function startDaemon(dir = home(), opts: DaemonOptions = {}): Promise<Daemon> {
  const sock = daemonSock(dir);
  if (await tryHello(sock, dir)) throw new Error(`a daemon is already answering on ${sock}`);
  const existed = existsSync(dir);
  const ours = existed && hasKiwiState(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = lockPath(dir);
  await takeLock(lock);
  if (process.platform !== "win32") {
    try {
      rmSync(sock, { force: true });
    } catch {
      // Giving up a stale path is the next line's error, not this one's.
    }
  }
  await ensureMachine(process.env.KIWI_RELAY ?? DEFAULT_RELAY);
  const token = Buffer.from(getRandomValues(new Uint8Array(32))).toString("base64url");
  writePrivate(daemonToken(dir), token);
  const tokenOk = (sent: string): boolean => {
    const a = Buffer.from(sent);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  if (process.platform !== "win32" && (!existed || ours)) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // A directory this user can't chmod must not stop the daemon.
    }
  }

  const hosted = new HostedTmux(dir);
  void hosted.resume().catch(() => {});
  const seats = new Map<string, Seat>();
  const admitter = startAdmitter(() => {
    const m = loadPairedMachine();
    return m && (m.cert || m.device?.links.length) ? m.identity : null;
  });
  const conns = new Set<ConnState>();
  const terms = new Map<ConnState, Set<() => void>>();
  let stopped = false;
  let resolveStopped: () => void = () => {};
  const stoppedP = new Promise<void>((resolve) => (resolveStopped = resolve));

  const why = (err: unknown): string => (err instanceof Error ? err.message : String(err));
  const opening = new Map<string, { promise: Promise<Seat>; waiters: Set<Waiting>; last: () => string | null }>();
  let beacons = 0;
  const reads = new Map<string, DaemonRead>();
  const retries = new Map<string, { at: number; delay: number; fp: string }>();
  const people = new Set<string>();
  const keeper: Waiting = { tell: () => {}, alive: () => !stopped };

  const fingerprint = (key: string, channel: Config["channels"][string] | null, alias: string, agent: string): string =>
    `${key}\u0000${JSON.stringify(channel)}\u0000${readCursor(alias, agent) === null ? "" : "joined"}`;
  const fingerprintOf = (key: string, alias: string, agent: string): string => fingerprint(key, loadConfig().channels[alias] ?? null, alias, agent);

  const backoff = (key: string, fp: string): void => {
    const prev = retries.get(key);
    const delay = prev && prev.fp === fp ? Math.min(prev.delay * 2, RETRY_MAX_MS) : (opts.retryFirstMs ?? RETRY_FIRST_MS);
    retries.set(key, { at: Date.now() + delay, delay, fp });
  };

  const stillWanted = (alias: string, roomId: string, agent: string): boolean => {
    const now = loadConfig().channels[alias];
    return !!now && now.roomId === roomId && identitiesIn(roomId).includes(agent);
  };

  const fieldsOf = (seat: Seat): PresenceFields => {
    const read = reads.get(readKey(seat.alias, seat.agent));
    return {
      client: "daemon",
      ...(seat.activity ? { activity: seat.activity } : {}),
      ...(seat.reach ? { reach: seat.reach } : {}),
      ...(read ? { readAt: read.at } : {}),
      ...(seat.wakeVia ? { wake: seat.wakeVia } : {}),
    };
  };

  const attachedTo = (seat: Seat): Attached => {
    const held = [...conns].filter((c) => !c.dead).flatMap((c) => [...c.held].filter((l) => l.channel === seat.alias && l.agent === seat.agent));
    if (seat.subs.size > 0 || held.some((l) => l.kind !== "session")) return "listener";
    return held.length ? "session" : "none";
  };

  const listenerGraceMs = opts.listenerGraceMs ?? LISTENER_GRACE_MS;
  const listenedLately = (seat: Seat, attached: Attached): boolean => {
    const at = Date.now();
    if (attached !== "listener") return at - (seat.listenerAt || seat.openedAt || at) < listenerGraceMs;
    seat.listenerAt = at;
    return true;
  };
  const livePath = async (cfg: Config, seat: Seat, attached: Attached) => listenedPath(await pathOf(cfg, seat.alias, seat.agent), listenedLately(seat, attached));

  const refreshActivity = async (seat: Seat, force = false, read = true): Promise<void> => {
    const cfg = loadConfig();
    const record = seatRecordFor(cfg, seat.alias, seat.agent);
    if (record?.rex?.block !== seat.rexBlock) {
      seat.rexBlock = record?.rex?.block;
      seat.rexGone = false;
      seat.rexActivity = undefined;
      seat.rexReadAt = undefined;
    }
    const env = record ? activityEnv(record, process.env) : null;
    const { harnessActivity } = await import("../harness.ts");
    let now = env ? await harnessActivity(env) : undefined;
    if (readsRex(cfg, record)) {
      if (read)
        readRexInto(seat, record.rex, readRex, () => {
          if (current(seat)) void refreshActivity(seat, false, false).catch(() => {});
        });
      const fromRex = seat.rexActivity;
      if (fromRex) now = { ...fromRex, ...(now?.model ? { model: now.model } : {}) };
    }
    const attached = attachedTo(seat);
    const pulled = attached === "listener" && pullsWake(record?.harness);
    const via = wakeOn(cfg, seat.alias, seat.agent) ? (viaOf(await livePath(cfg, seat, attached)) ?? (pulled ? "listener" : null)) : null;
    const reach = seat.rexGone ? "unreachable" : reachOf(attached, record, now);
    if (!force && JSON.stringify(now) === JSON.stringify(seat.activity) && via === seat.wakeVia && reach === seat.reach) return;
    seat.activity = now;
    seat.wakeVia = via;
    seat.reach = reach;
    seat.announce?.();
  };

  const current = (seat: Seat): boolean => !stopped && seats.get(seat.key) === seat;

  let rexPlugin: Promise<TerminalPlugin> | null = null;
  const rex = (): Promise<TerminalPlugin> => (rexPlugin ??= terminalPlugin("rex"));
  const readRex = async (place: RexPlace): Promise<RexActivity | null> => (await rex()).activity?.({ rex: place }) ?? null;

  const { scheduleWake } = seatWakes({
    dir,
    wakeDelayMs: opts.wakeDelayMs ?? WAKE_DELAY_MS,
    wakeGapMs: opts.wakeGapMs ?? WAKE_GAP_MS,
    wakeOutstandingMs: opts.wakeOutstandingMs ?? WAKE_OUTSTANDING_MS,
    stopped: () => stopped,
    current,
    hosted,
  });

  const seatInfo = async (s: Seat): Promise<DaemonSeat> => {
    const cfg = loadConfig();
    return {
      channel: s.alias,
      agent: s.agent,
      subscribers: s.subs.size,
      read: reads.get(readKey(s.alias, s.agent)) ?? null,
      wake: { on: wakeOn(cfg, s.alias, s.agent), path: await livePath(cfg, s, attachedTo(s)), last: s.lastWake },
      reach: s.reach,
    };
  };

  const flush = (conn: ConnState): boolean => {
    for (let head = conn.out[0]; head; head = conn.out[0]) {
      const wrote = conn.socket.write(head);
      if (wrote < 0) return false;
      conn.queued -= Math.min(wrote, head.byteLength);
      if (wrote < head.byteLength) {
        conn.out[0] = head.subarray(wrote);
        return true;
      }
      conn.out.shift();
    }
    return true;
  };

  const dropConn = (conn: ConnState): void => {
    killConn(conn);
    try {
      conn.socket.end();
    } catch {
      // Already closed: killConn has reaped it.
    }
  };

  const flushOrDrop = (conn: ConnState): boolean => {
    try {
      if (flush(conn)) return true;
    } catch {
      // The socket went away mid-write: dropped below like any closed connection.
    }
    dropConn(conn);
    return false;
  };

  const sendLine = (conn: ConnState, line: string): boolean => {
    if (conn.dead) return false;
    const bytes = lineEncoder.encode(line + "\n");
    if (conn.queued + bytes.byteLength > MAX_QUEUED_BYTES) {
      dropConn(conn);
      return false;
    }
    conn.out.push(bytes);
    conn.queued += bytes.byteLength;
    return conn.out.length > 1 || flushOrDrop(conn);
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
    seat.probe = null;
    seat.rows = null;
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
    for (const close of terms.get(conn) ?? []) close();
    terms.delete(conn);
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
    backoff(seat.key, fingerprintOf(seat.key, seat.alias, seat.agent));
  };

  const beaconMs = opts.beaconMs ?? 60_000;

  const firstHead = async (ch: Channel, waiting: Waiting): Promise<number> => {
    const { ChannelGone, RelayError } = await import("@kiwi/core/client.ts");
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
        if (answered(err) || stopped || !waiting.alive()) throw new Error(why(err), { cause: err });
        if (!told) {
          told = true;
          waiting.tell(`can't reach the relay (${why(err)}); still retrying`);
        }
        const until = Date.now() + backoff;
        while (Date.now() < until) {
          if (stopped || !waiting.alive()) throw new Error(why(err), { cause: err });
          await Bun.sleep(Math.min(250, until - Date.now()));
        }
      }
    }
  };

  const opened = (seat: Seat, presence: (p: PresenceFields) => Promise<void>, mark: (seq: number) => boolean, probe: (ms: number) => Promise<Probe | null>): void => {
    if (seats.get(seat.key) !== seat || seat.ctl.signal.aborted) return;
    seat.mark = mark;
    seat.probe = probe;
    seat.rows = null;
    seat.openedAt = Date.now();
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
      const { Channel } = await import("@kiwi/core/client.ts");
      const ch = new Channel(c, c.relay, id, (a) => saveAccess(alias, a));
      const head = await firstHead(ch, anyone);
      if (stopped) throw new Error("the daemon is stopping");
      if (!anyone.alive()) throw new Error("nobody is waiting for this channel any more");
      if (!stillWanted(alias, c.roomId, agent)) throw new Error(`"${agent}" no longer has a key in "${alias}" on this computer`);
      const self = (await ch.members()).find((m) => m.pk === id.pk);
      if (!self || self.unverified || self.owner || self.kind === "human") throw new NotAgentSeat(`"${agent}" isn't an agent in "${alias}": the daemon holds seats for agents only`);
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
        outstanding: null,
        probe: null,
        rows: null,
        fetchingRows: false,
        heard: new Map(),
        openedAt: null,
        listenerAt: 0,
      };
      seats.set(key, seat);
      if (stopped) {
        seats.delete(key);
        endSeat(seat);
        throw new Error("the daemon is stopping");
      }
      ch.stream(
        seat.head,
        (m) => {
          if (m.seq > seat.head) seat.head = m.seq;
          heardList(m);
          if (m.from !== seat.agent) scheduleWake(seat);
          for (const sub of [...seat.subs]) {
            if (sub.held) sub.held.push(m);
            else if (m.seq > sub.cursor && sendLine(sub.conn, JSON.stringify({ id: sub.id, message: m }))) sub.cursor = m.seq;
          }
        },
        {
          signal: seat.ctl.signal,
          onOpen: ({ presence, mark, probe }) => opened(seat, presence, mark, probe),
          onPresence: (p) => {
            if (p.sigOk && p.pk && !p.query && p.client !== "probe" && p.from !== seat.agent) seat.heard.set(p.pk, { presence: p, at: Date.now() });
            if (!p.query || Date.now() - seat.lastProbe < PROBE_ANSWER_GAP_MS) return;
            seat.lastProbe = Date.now();
            seat.announce?.();
          },
          onRoster: () => tell(seat, { event: "roster" }),
          onInfo: () => tell(seat, { event: "info" }),
          onRequest: () => {
            tell(seat, { event: "request" });
            admitter.watch({ relay: c.relay, roomId: c.roomId, ownerPk: c.ownerPk }, 0);
          },
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

  const heardList = (m: Message): void => {
    if (m.sigOk && m.kind === "event" && m.ev?.op === "devices") void takeDeviceList(m.ev.links).catch(() => null);
  };

  const onListen = async (conn: ConnState, id: number, params: Record<string, unknown>): Promise<void> => {
    const { channel, as, cursor } = params as { channel?: unknown; as?: unknown; cursor?: unknown };
    if (typeof channel !== "string" || !channel || typeof as !== "string" || !as) throw new Error('listen needs {"channel", "as", cursor}');
    if (typeof cursor !== "number" || !Number.isInteger(cursor) || cursor < 0) throw new Error("listen needs a cursor: the last sequence number this subscriber saw (0 for everything)");
    const seat = await seatFor(channel, as, { tell: (s) => sendLine(conn, JSON.stringify({ id, status: s })), alive: () => !conn.dead });
    if (conn.dead || stopped) return;
    const sub: Sub = { id, cursor, conn, seat, held: [] };
    seat.subs.add(sub);
    conn.subs.add(sub);
    reachMoved(seat.alias, seat.agent);
    sendLine(conn, JSON.stringify({ id, ok: true, stream: true, head: seat.head, channel, agent: as }));
    try {
      const { messages } = await seat.ch.history(cursor);
      const caught = [...messages, ...(sub.held ?? [])];
      sub.held = null;
      for (const m of caught) heardList(m);
      for (const m of caught) {
        if (m.seq <= sub.cursor) continue;
        if (sendLine(conn, JSON.stringify({ id, message: m }))) sub.cursor = m.seq;
        else break;
      }
    } catch (err) {
      dropSub(sub);
      sendLine(conn, JSON.stringify({ id, ok: false, error: why(err) }));
    }
  };

  const refreshRows = (seat: Seat, probe: (ms: number) => Promise<Probe | null>, changes: number): void => {
    if (seat.fetchingRows) return;
    seat.fetchingRows = true;
    void Promise.all([seat.ch.memberRows(), seat.ch.info()])
      .then(([members, info]) => {
        if (seat.probe === probe) seat.rows = { probe, changes, members, info };
      })
      .catch(() => {})
      .finally(() => {
        seat.fetchingRows = false;
      });
  };

  const onPeek = async (conn: ConnState, id: number, params: Record<string, unknown>): Promise<void> => {
    const { channel, as, room } = params;
    const seat = [...seats.values()].find((s) => s.alias === channel && s.agent === as && s.ch.roomId === room);
    const probe = seat?.probe ?? null;
    const seen = seat && probe ? await probe(PEEK_PROBE_MS) : null;
    if (!seat || !probe || !seen || seat.probe !== probe || !current(seat)) {
      sendLine(conn, JSON.stringify({ id, ok: true, live: false }));
      return;
    }
    const rows = seat.rows && seat.rows.probe === probe && seat.rows.changes === seen.changes ? seat.rows : null;
    if (!rows) refreshRows(seat, probe, seen.changes);
    sendLine(conn, JSON.stringify({ id, ok: true, live: true, head: seen.head, ...(rows ? { members: rows.members, info: rows.info } : {}) }));
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
        const fp = fingerprint(key, c, alias, agent);
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

  const seatSync = throttled(syncSeats, SYNC_ON_REQUEST_MS);

  let pairingBusy: Promise<unknown> = Promise.resolve();
  const adoptOn = async (conn: ConnState, id: number, params: Record<string, unknown>): Promise<void> => {
    const person = params.person as Partial<PairedPerson> | null;
    if (!person || typeof person.pk !== "string" || typeof person.xpk !== "string" || typeof person.name !== "string") {
      throw new Error("adopt needs {cert or links, person: {pk, xpk, name}}");
    }
    const named = { pk: person.pk, xpk: person.xpk, name: person.name };
    const m = await ensureMachine(process.env.KIWI_RELAY ?? DEFAULT_RELAY);
    let paired: PairedMachine;
    if (Array.isArray(params.links)) {
      const read = await readDeviceList(params.links);
      if (!read.ok) throw new Error(`that device list doesn't check out: ${read.why}`);
      if (read.list.person !== named.pk) throw new Error("that device list is another person's than the one named");
      if (!listedComputer(read.list, m.identity.pk)) throw new Error("that device list doesn't list this computer");
      const kept = m.device?.person.pk === named.pk ? await readDeviceList(m.device.links) : null;
      if (kept?.ok && kept.list.version > read.list.version) throw new Error("this computer already holds a newer device list");
      const device = { person: named, links: params.links as DeviceLink[] };
      paired = m.cert?.pk === named.pk ? { ...m, device } : { identity: m.identity, label: m.label, relay: m.relay, device };
    } else {
      const cert = await readMachineCert(params.cert);
      if (!cert) throw new Error("that cert doesn't check out (wrong signature or shape)");
      if (named.pk !== cert.pk) throw new Error("that cert is by another person than the one named");
      if (cert.machine !== m.identity.pk) throw new Error("that cert is for another computer");
      paired = { ...m, cert, person: named };
    }
    const pairedTo = m.person?.pk ?? m.device?.person.pk ?? null;
    if (pairedTo && pairedTo !== named.pk) {
      const pairedName = m.person?.name ?? m.device?.person.name ?? "someone else";
      throw new Error(`this computer is already paired with ${pairedName}; unpair it first (kiwi unpair)`);
    }
    saveMachine(paired);
    sendLine(conn, JSON.stringify({ id, ok: true }));
  };

  const onRequest = async (conn: ConnState, raw: string): Promise<void> => {
    let req: { id?: unknown; verb?: unknown } & Record<string, unknown>;
    try {
      req = JSON.parse(raw) as typeof req;
    } catch {
      return;
    }
    if (!req || typeof req !== "object" || typeof req.id !== "number" || typeof req.verb !== "string") return;
    const id = req.id;
    const verb = req.verb;
    const params: Record<string, unknown> = req;
    if (typeof req.token !== "string" || !tokenOk(req.token)) {
      sendLine(conn, JSON.stringify({ id, ok: false, error: "this daemon answers only a caller holding its token" }));
      return;
    }
    seatSync.soon();
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
              person: m?.person ?? m?.device?.person ?? null,
              certified: !!m?.cert || !!m?.device?.links.length,
            }),
          );
          break;
        }
        case "adopt": {
          const run = pairingBusy.then(() => adoptOn(conn, id, params));
          pairingBusy = run.catch(() => undefined);
          await run;
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
        case "peek":
          await onPeek(conn, id, params);
          break;
        case "presence": {
          const seat = [...seats.values()].find((s) => s.alias === params.channel && s.agent === params.as);
          const since = seat?.probe ? seat.openedAt : null;
          sendLine(conn, JSON.stringify(seat && since !== null ? { id, ok: true, live: true, since, beaconMs, presence: [...seat.heard.values()] } : { id, ok: true, live: false }));
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
        case "harnesses":
          sendLine(conn, JSON.stringify({ id, ok: true, harnesses: await harnessInventory() }));
          break;
        case "folders": {
          const room = typeof params.room === "string" && /^[0-9a-f]{32}$/.test(params.room) ? params.room : undefined;
          sendLine(conn, JSON.stringify({ id, ok: true, folders: launchFolders(loadConfig(), room) }));
          break;
        }
        case "admit": {
          const room = readAdmitRoom(params);
          if (!room) throw new Error('admit needs {"relay", "room", "owner"}');
          admitter.watch(room);
          sendLine(conn, JSON.stringify({ id, ok: true }));
          break;
        }
        case "unpair":
          await unpairHere();
          sendLine(conn, JSON.stringify({ id, ok: true }));
          break;
        case "launch": {
          const launch = readLaunchRequest(params);
          if (!launch) throw new Error('launch needs {"harness", "folder", "code", "relay"?, "nick"?, "persona"?, "launch"?: an id of 8 to 64 of A-Z a-z 0-9 _ -}');
          if (launch.permission === "bypass" && !remoteBypassOn(loadConfig())) throw new Error(NO_SOCKET_BYPASS);
          sendLine(conn, JSON.stringify({ id, ok: true, launched: await launchAgent(launch, { hosted }) }));
          break;
        }
        case "loop": {
          const start = readLoopStart(params);
          if (!start) throw new Error('loop needs {"channel", "as", "folder", "harness"?, "model"?, "effort"?}');
          const opened = await startLoop(start, hosted);
          if (!opened.ok) throw new Error(opened.detail);
          sendLine(conn, JSON.stringify({ id, ok: true, opened }));
          break;
        }
        case "term": {
          const { pane } = params;
          const cols = clampSize(params.cols, TERM_COLS);
          const rows = clampSize(params.rows, TERM_ROWS);
          if (!isPane(pane) || !cols || !rows) throw new Error('term needs {"pane", "cols", "rows"}');
          const term = await openTerm(hosted, pane, cols, rows, (msg) => sendLine(conn, JSON.stringify({ id, ...msg })));
          if (conn.dead) {
            term.close();
            break;
          }
          terms.set(conn, new Set([...(terms.get(conn) ?? []), term.close]));
          sendLine(conn, JSON.stringify({ id, ok: true, stream: true, ...term.opened }));
          term.start();
          break;
        }
        case "mine": {
          const room = typeof params.room === "string" && /^[0-9a-f]{32}$/.test(params.room) ? params.room : undefined;
          const want = params.want === "new" || isPane(params.want) ? params.want : null;
          const mine = await hosted.mine(seatFolders(loadConfig(), room)[0] ?? homedir(), want);
          if (!mine.ok) throw new Error(mine.detail);
          sendLine(conn, JSON.stringify({ id, ok: true, pane: mine.pane }));
          break;
        }
        case "mine-tabs":
          sendLine(conn, JSON.stringify({ id, ok: true, tabs: await hosted.mineTabs() }));
          break;
        case "mine-close": {
          if (!isPane(params.pane)) throw new Error('mine-close needs {"pane"}');
          sendLine(conn, JSON.stringify({ id, ok: true, tabs: await hosted.closeMine(params.pane) }));
          break;
        }
        case "term-keys": {
          const { pane, keys } = params;
          if (!isPane(pane) || typeof keys !== "string" || keys.length > 65_536) throw new Error('term-keys needs {"pane", "keys"}');
          sendLine(conn, JSON.stringify({ id, ok: hosted.keys(pane, keys) }));
          break;
        }
        case "term-size": {
          const { pane } = params;
          const cols = clampSize(params.cols, TERM_COLS);
          const rows = clampSize(params.rows, TERM_ROWS);
          if (!isPane(pane) || !cols || !rows) throw new Error('term-size needs {"pane", "cols", "rows"}');
          sendLine(conn, JSON.stringify({ id, ok: hosted.resize(pane, cols, rows), cols, rows }));
          break;
        }
        case "stop":
          sendLine(conn, JSON.stringify({ id, ok: true }));
          setTimeout(() => void stop(), 50);
          break;
        default:
          throw new Error(
            `unknown verb "${verb}" (hello, adopt, admit, listen, listening, hold, listeners, read, mark, peek, presence, harnesses, folders, launch, loop, term, mine, mine-tabs, mine-close, term-keys, term-size, unpair, stop)`,
          );
      }
    } catch (err) {
      sendLine(conn, JSON.stringify({ id, ok: false, error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const umaskWas = process.platform !== "win32" ? process.umask(0o077) : null;
  let server: ReturnType<typeof Bun.listen>;
  try {
    server = Bun.listen({
      unix: sock,
      socket: {
        open(socket) {
          conns.add({ socket: socket as Socket, decoder: new TextDecoder(), buf: "", subs: new Set(), held: new Set(), dead: false, out: [], queued: 0 });
        },
        drain(socket) {
          const conn = [...conns].find((c) => c.socket === socket);
          if (conn && !conn.dead) flushOrDrop(conn);
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
        error() {},
      },
    });
  } finally {
    if (umaskWas !== null) process.umask(umaskWas);
  }
  if (process.platform !== "win32") {
    try {
      chmodSync(sock, 0o600);
    } catch {
      // Same as the home chmod: a mode this user can't set must not stop the daemon.
    }
  }
  const boundIno = inodeOf(sock);

  const tickMs = opts.tickMs ?? TICK_MS;
  const orphanTicks = Math.ceil((opts.orphanMs ?? ORPHAN_MS) / tickMs);
  let deadTicks = 0;
  const orphaned = async (): Promise<boolean> => {
    if (conns.size) return false;
    let relays: string[];
    try {
      relays = [...new Set(Object.values(loadConfig().channels).map((c) => c.relay ?? DEFAULT_RELAY))];
    } catch {
      return false;
    }
    if (!relays.length || !relays.every(onLoopback)) return false;
    return (await Promise.all(relays.map(answers))).every((up) => !up);
  };
  let statusWatch: { stop(): void } | null = null;
  let relayForget: Promise<unknown> = Promise.resolve();
  const unpairHere = async (): Promise<void> => {
    const m = loadPairedMachine();
    if (m?.cert || m?.device) {
      saveMachine({ identity: m.identity, label: m.label, relay: m.relay });
      relayForget = relayForget
        .then(() => forgetAtRelay(m))
        .catch(() => {
          // The relay forgets this machine when it next hears from it; local pairing is already gone.
        });
    }
    inbox.close();
  };
  const inbox = startMachineInbox({
    dir,
    machine: loadPairedMachine,
    unpaired: unpairHere,
    settled: () => relayForget,
    run: remoteRunner({
      inventory: () => harnessInventory(),
      folders: (room) => remoteFolders(loadConfig(), room),
      launch: (req) => launchAgent(req, { hosted }),
      bypass: () => remoteBypassOn(loadConfig()),
      settings: async () => computerSettings(loadConfig(), hooksRows()),
      starts: join(dir, "remote-launches.json"),
    }),
  });
  let rexWatch: { stop(): void } | null = null;
  const rexSeat = (match: (place: SeatPlace) => boolean, gone: boolean): void => {
    let cfg: Config;
    try {
      cfg = loadConfig();
    } catch {
      return;
    }
    for (const seat of seats.values()) {
      const record = seatRecordFor(cfg, seat.alias, seat.agent);
      if (!record?.rex || !match(record)) continue;
      seat.rexGone = gone;
      void refreshActivity(seat, true).catch(() => {});
    }
  };
  const watchStatus = async (): Promise<void> => {
    const [marks, on] = ((): [boolean, boolean] => {
      try {
        const cfg = loadConfig();
        return [marking(cfg).length > 0, helpersOn("rex", cfg)];
      } catch {
        return [false, false];
      }
    })();
    if (marks && !statusWatch) {
      const { startStatusWatch } = await import("../status.ts");
      if (stopped) return;
      statusWatch = startStatusWatch({
        seats: () => [...seats.values()].map((s) => ({ key: s.key, alias: s.alias, agent: s.agent, head: s.head })),
        current: (s) => {
          const seat = seats.get(s.key);
          return !!seat && current(seat) && seat.alias === s.alias && seat.agent === s.agent;
        },
        stopped: () => stopped,
      });
    } else if (!marks && statusWatch) {
      statusWatch.stop();
      statusWatch = null;
    }
    if (on && !rexWatch) {
      const plugin = await rex();
      if (stopped) return;
      rexWatch =
        plugin.watch?.(() => {
          const cfg = loadConfig();
          return [...seats.values()].flatMap((seat) => {
            const record = seatRecordFor(cfg, seat.alias, seat.agent);
            return record?.rex ? [record] : [];
          });
        }, rexSeat) ?? null;
    } else if (!on && rexWatch) {
      rexWatch.stop();
      rexWatch = null;
    }
  };
  let prunedAt = 0;
  const pruneNow = (): void => {
    if (Date.now() - prunedAt < PRUNE_EVERY_MS) return;
    prunedAt = Date.now();
    pruneHookFiles(dir, HOOK_FILES_KEEP_MS);
  };
  pruneNow();
  const tick = setInterval(() => {
    pruneNow();
    void watchStatus();
    if (!existsSync(dir) || !beatLock(lock)) return void stop();
    void seatSync.now();
    void orphaned().then((dead) => {
      deadTicks = dead ? deadTicks + 1 : 0;
      if (deadTicks >= orphanTicks) void stop();
    });
  }, tickMs);

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    clearInterval(tick);
    admitter.stop();
    statusWatch?.stop();
    statusWatch = null;
    inbox.stop();
    rexWatch?.stop();
    rexWatch = null;
    await hosted.detach();
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
    const theirs = boundIno !== null && inodeOf(sock) !== null && inodeOf(sock) !== boundIno ? `${sock}.${process.pid}.aside` : null;
    const aside = theirs !== null && moved(sock, theirs);
    try {
      server.stop();
    } catch {
      // Already stopped; the socket file below is what matters.
    }
    if (aside && theirs) moved(theirs, sock);
    if (process.platform !== "win32" && !theirs && ownsLock(lock)) {
      try {
        rmSync(sock, { force: true });
      } catch {
        // A stale socket file is harmless: the next start removes it.
      }
    }
    dropLock(lock);
  };

  await seatSync.now();
  await watchStatus();
  try {
    for (const c of Object.values(loadConfig().channels)) admitter.watch({ relay: c.relay ?? DEFAULT_RELAY, roomId: c.roomId, ownerPk: c.ownerPk }, 0);
  } catch {
    // An unreadable config names no channels to look at: pokes and request frames still admit.
  }
  return { sock, stop, stopped: stoppedP, hosted, beacons: () => beacons, admitting: () => admitter.watching() };
}

function onLoopback(relay: string): boolean {
  try {
    const host = new URL(relay).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

function inodeOf(path: string): number | null {
  try {
    return statSync(path).ino;
  } catch {
    return null;
  }
}

function moved(from: string, to: string): boolean {
  try {
    renameSync(from, to);
    return true;
  } catch {
    return false;
  }
}

function answers(relay: string): Promise<boolean> {
  return new Promise((resolve) => {
    const u = new URL(relay);
    const settle = (up: boolean): void => {
      clearTimeout(late);
      resolve(up);
    };
    const late = setTimeout(() => resolve(false), 1_000);
    Bun.connect({
      hostname: u.hostname.replace(/^\[|\]$/g, ""),
      port: Number(u.port || (u.protocol === "https:" ? 443 : 80)),
      socket: {
        open(socket) {
          socket.end();
          settle(true);
        },
        data() {},
        connectError() {
          settle(false);
        },
      },
    }).catch(() => settle(false));
  });
}

export async function runDaemonForeground(dir = home()): Promise<void> {
  (globalThis as { __kiwiDisarmEarlySignals?: () => void }).__kiwiDisarmEarlySignals?.();
  const goodbye = new Promise<void>((resolve) => {
    process.once("SIGTERM", () => resolve());
    process.once("SIGINT", () => resolve());
  });
  const sock = daemonSock(dir);
  const live = await tryHello(sock, dir);
  if (live && compareVersions(live.version, VERSION) >= 0) throw new PairError(`a kiwi ${live.version} daemon is already running (pid ${live.pid}) on ${sock}`);
  if (live) await stopDaemon(sock, dir);
  const serving = await startDaemon(dir);
  process.stdout.write(`kiwi daemon ${VERSION} on ${sock} (pid ${process.pid})\n`);
  await Promise.race([goodbye, serving.stopped]);
  await serving.stop().catch(() => {});
}
