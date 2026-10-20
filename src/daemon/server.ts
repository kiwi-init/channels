import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import type { Socket } from "bun";
import type { Channel, PresenceFields, Probe } from "@kiwi/core/client.ts";
import { DEFAULT_RELAY, hasKiwiState, home, identitiesIn, loadConfig, loadIdentity, saveAccess, type Config } from "../config.ts";
import { saveMachine } from "../machine.ts";
import { readMachineCert } from "@kiwi/core/person.ts";
import { VERSION } from "../version.ts";
import { compareVersions } from "@kiwi/core/versions.ts";
import { pullsWake, viaOf } from "@kiwi/core/wake.ts";
import { ensureMachine, loadPairedMachine, PairError, type PairedMachine, type PairedPerson } from "./pair.ts";
import { DAEMON_PROTOCOL, daemonSock, readListener, type DaemonEvent, type DaemonRead, type DaemonSeat, type DaemonVerb } from "./protocol.ts";
import { activityEnv, reachOf, seatRecordFor, wakeOn, type Attached } from "./reach.ts";
import { pruneHookFiles } from "../hooks/delivered.ts";
import { beatLock, dropLock, lockPath, ownsLock, takeLock } from "./lock.ts";
import { stopDaemon, tryHello } from "./rpc.ts";
import { readKey, type ConnState, type Seat, type Sub, type Waiting } from "./seat.ts";
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

class NotAgentSeat extends Error {}

export interface Daemon {
  readonly sock: string;
  stop(): Promise<void>;
  readonly stopped: Promise<void>;
  beacons(): number;
}

export interface DaemonOptions {
  beaconMs?: number;
  wakeDelayMs?: number;
  wakeGapMs?: number;
  tickMs?: number;
  orphanMs?: number;
  wakeOutstandingMs?: number;
}

const WAKE_DELAY_MS = 2_000;
const WAKE_GAP_MS = 60_000;
const WAKE_OUTSTANDING_MS = 10 * 60_000;

export async function startDaemon(dir = home(), opts: DaemonOptions = {}): Promise<Daemon> {
  const sock = daemonSock(dir);
  if (await tryHello(sock)) throw new Error(`a daemon is already answering on ${sock}`);
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

  const why = (err: unknown): string => (err instanceof Error ? err.message : String(err));
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

  const refreshActivity = async (seat: Seat, force = false): Promise<void> => {
    const cfg = loadConfig();
    const record = seatRecordFor(cfg, seat.alias, seat.agent);
    const env = record ? activityEnv(record, process.env) : null;
    const { harnessActivity } = await import("../harness.ts");
    const now = env ? await harnessActivity(env) : undefined;
    const attached = attachedTo(seat);
    const pulled = attached === "listener" && pullsWake(record?.harness);
    const via = wakeOn(cfg, seat.alias, seat.agent) ? (viaOf(await pathOf(cfg, seat.alias, seat.agent)) ?? (pulled ? "listener" : null)) : null;
    const reach = reachOf(attached, record, now);
    if (!force && JSON.stringify(now) === JSON.stringify(seat.activity) && via === seat.wakeVia && reach === seat.reach) return;
    seat.activity = now;
    seat.wakeVia = via;
    seat.reach = reach;
    seat.announce?.();
  };

  const current = (seat: Seat): boolean => !stopped && seats.get(seat.key) === seat;

  const { scheduleWake } = seatWakes({
    dir,
    wakeDelayMs: opts.wakeDelayMs ?? WAKE_DELAY_MS,
    wakeGapMs: opts.wakeGapMs ?? WAKE_GAP_MS,
    wakeOutstandingMs: opts.wakeOutstandingMs ?? WAKE_OUTSTANDING_MS,
    stopped: () => stopped,
    current,
  });

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
        outstanding: null,
        probe: null,
        rows: null,
        fetchingRows: false,
        heard: new Map(),
        openedAt: null,
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
            if (!p.query && p.client !== "probe" && p.from !== seat.agent) seat.heard.set(p.from, { presence: p, at: Date.now() });
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
      return;
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
        case "stop":
          sendLine(conn, JSON.stringify({ id, ok: true }));
          setTimeout(() => void stop(), 50);
          break;
        default:
          throw new Error(`unknown verb "${verb}" (hello, adopt, listen, listening, hold, listeners, read, mark, peek, presence, stop)`);
      }
    } catch (err) {
      sendLine(conn, JSON.stringify({ id, ok: false, error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const server = Bun.listen({
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
  let prunedAt = 0;
  const pruneNow = (): void => {
    if (Date.now() - prunedAt < PRUNE_EVERY_MS) return;
    prunedAt = Date.now();
    pruneHookFiles(dir, HOOK_FILES_KEEP_MS);
  };
  pruneNow();
  const tick = setInterval(() => {
    pruneNow();
    if (!existsSync(dir) || !beatLock(lock)) return void stop();
    void syncSeats();
    void orphaned().then((dead) => {
      deadTicks = dead ? deadTicks + 1 : 0;
      if (deadTicks >= orphanTicks) void stop();
    });
  }, tickMs);

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

  await syncSeats();
  return { sock, stop, stopped: stoppedP, beacons: () => beacons };
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
  const live = await tryHello(sock);
  if (live && compareVersions(live.version, VERSION) >= 0) throw new PairError(`a kiwi ${live.version} daemon is already running (pid ${live.pid}) on ${sock}`);
  if (live) await stopDaemon(sock);
  const serving = await startDaemon(dir);
  process.stdout.write(`kiwi daemon ${VERSION} on ${sock} (pid ${process.pid})\n`);
  await Promise.race([goodbye, serving.stopped]);
  await serving.stop().catch(() => {});
}
