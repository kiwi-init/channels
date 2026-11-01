import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Socket } from "bun";
import type { Info, MemberRow } from "@kiwi/core/client.ts";
import { readHarnessRow, type HarnessRow } from "@kiwi/core/harnesses.ts";
import { readLaunched, readOpened, type Launched, type Opened } from "@kiwi/core/terminals.ts";
import type { LaunchRequest } from "../launch/wire.ts";
import type { LoopStart } from "../loop/start.ts";
import { home } from "../config.ts";
import type { DeviceLink } from "@kiwi/core/devices.ts";
import type { MachineCert } from "@kiwi/core/person.ts";
import type { Message, Presence } from "@kiwi/core/protocol.ts";
import { VERSION } from "../version.ts";
import { compareVersions } from "@kiwi/core/versions.ts";
import type { PairedPerson } from "./pair.ts";
import { lockPath } from "./lock.ts";
import type { AdmitRoom } from "./admit.ts";
import { DAEMON_PROTOCOL, daemonSock, isDaemonEvent, readListener, withDeadline, type DaemonEvent, type DaemonHello, type DaemonListener, type DaemonPeek, type DaemonSeat } from "./protocol.ts";

const PEEK_MS = 300;

function daemonTokenFor(sock: string, dir?: string): string | null {
  const file = process.platform === "win32" ? join(dir ?? home(), "daemon.token") : join(dirname(sock), "daemon.token");
  try {
    const read = readFileSync(file, "utf8").trim();
    return read || null;
  } catch {
    // No token file: a daemon from before it answered without one, and frames still carry ours.
    return null;
  }
}

type Reply = { id: number; ok: true; [k: string]: unknown } | { id: number; ok: false; error: string };

interface DaemonConn {
  call(verb: string, params?: Record<string, unknown>): Promise<Extract<Reply, { ok: true }>>;
  subscribe(params: Record<string, unknown>, onMessage: (m: Message) => void, onError: (err: Error) => void, side?: SideLines): Promise<Extract<Reply, { ok: true }>>;
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
  live?: boolean;
}

async function openConn(sock: string, timeoutMs = 15_000, dir?: string): Promise<DaemonConn> {
  let buf = "";
  const decoder = new TextDecoder();
  const token = daemonTokenFor(sock, dir);
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
              const err = new Error(typeof msg.error === "string" ? msg.error : "the daemon refused without saying why");
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
          else p.reject(new Error(typeof msg.error === "string" ? msg.error : "the daemon refused without saying why"));
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
  const send = (body: Record<string, unknown>, entry: Pending): void => {
    const id = next++;
    const timer = setTimeout(() => {
      if (pending.delete(id)) entry.reject(new Error(`kiwi daemon on ${sock} didn't answer in ${timeoutMs / 1000}s; it may be busy or stuck: \`kiwi doctor\` checks it`));
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
      socket.write(JSON.stringify({ id, ...body, ...(token ? { token } : {}) }) + "\n");
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

export async function tryHello(sock: string, dir?: string): Promise<DaemonHello | null> {
  try {
    const c = await openConn(sock, 2_000, dir);
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

const SPAWN_GAP_MS = 15_000;

export function claimSpawn(dir: string, now = Date.now()): boolean {
  const mark = join(dir, "daemon.spawning");
  const st = statSync(mark, { throwIfNoEntry: false });
  if (st && now - st.mtimeMs < SPAWN_GAP_MS && existsSync(lockPath(dir))) return false;
  try {
    writeFileSync(mark, String(process.pid), { mode: 0o600 });
    utimesSync(mark, new Date(now), new Date(now));
  } catch {
    // A home Kiwi can't write to can't hold the stamp: spawning still goes ahead.
  }
  return true;
}

export async function ensureDaemon(dir = home(), argv?: string[]): Promise<DaemonHello> {
  const sock = daemonSock(dir);
  const where = resolve(dir);
  const current = (h: DaemonHello | null): h is DaemonHello => !!h && compareVersions(h.version, VERSION) >= 0 && h.protocol >= DAEMON_PROTOCOL;
  const live = await tryHello(sock, where);
  if (current(live)) return live;
  if (live) await stopDaemon(sock, where);
  if (live || claimSpawn(where)) spawnDaemon(dir, argv);
  const until = Date.now() + 15_000;
  for (;;) {
    const hello = await tryHello(sock, where);
    if (current(hello)) return hello;
    if (Date.now() > until) throw new Error(`kiwi daemon didn't start on ${sock} within 15s: run \`kiwi daemon\` in a terminal to see why`);
    await Bun.sleep(100);
  }
}

export function spawnDaemon(dir = home(), argv?: string[]): void {
  const cmd = argv ?? cliDaemonArgv();
  const abs = resolve(dir);
  const child = spawn(cmd[0]!, cmd.slice(1), { cwd: abs, env: { ...process.env, KIWI_HOME: abs }, stdio: "ignore", detached: true });
  child.unref();
}

function cliDaemonArgv(): string[] {
  const argv = [process.execPath];
  const main = process.argv[1];
  if (main && main !== "daemon" && (main.endsWith(".ts") || main.endsWith(".js"))) argv.push(main);
  argv.push("daemon");
  return argv;
}

export async function daemonHello(sock = daemonSock()): Promise<DaemonHello> {
  const hello = await tryHello(sock);
  if (!hello) throw new Error(`no daemon on ${sock} (start one with: kiwi daemon)`);
  return hello;
}

export async function adoptDaemon(proof: { cert: MachineCert } | { links: DeviceLink[] }, person: PairedPerson, sock = daemonSock()): Promise<void> {
  const c = await openConn(sock);
  try {
    await c.call("adopt", { ...proof, person });
  } finally {
    c.close();
  }
}

export async function daemonAdmit(room: AdmitRoom, sock = daemonSock()): Promise<void> {
  const c = await openConn(sock, 2_000);
  try {
    await c.call("admit", { relay: room.relay, room: room.roomId, owner: room.ownerPk });
  } finally {
    c.close();
  }
}

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

export async function daemonHarnesses(sock = daemonSock()): Promise<HarnessRow[]> {
  const c = await openConn(sock);
  try {
    const r = await c.call("harnesses");
    return (Array.isArray(r.harnesses) ? r.harnesses : []).map(readHarnessRow).filter((h): h is HarnessRow => !!h);
  } finally {
    c.close();
  }
}

export async function daemonLaunch(req: LaunchRequest, sock = daemonSock()): Promise<Launched> {
  const c = await openConn(sock, 150_000);
  try {
    const r = await c.call("launch", { ...req });
    const launched = readLaunched(r.launched);
    if (!launched) throw new Error("the daemon answered a launch in a shape this kiwi doesn't know");
    return launched;
  } finally {
    c.close();
  }
}

export async function daemonLoop(start: LoopStart, sock = daemonSock()): Promise<Opened> {
  const c = await openConn(sock, 30_000);
  try {
    const r = await c.call("loop", { ...start });
    const opened = readOpened(r.opened);
    if (!opened) throw new Error("the daemon answered a loop start in a shape this kiwi doesn't know");
    return opened;
  } finally {
    c.close();
  }
}

export async function daemonUnpair(sock = daemonSock()): Promise<void> {
  const c = await openConn(sock);
  try {
    await c.call("unpair");
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

const isText = (v: unknown): v is string => typeof v === "string";

function memberRows(v: unknown): MemberRow[] | null {
  if (!Array.isArray(v)) return null;
  const rows: MemberRow[] = [];
  for (const x of v as unknown[]) {
    if (!x || typeof x !== "object") return null;
    const r = x as Record<string, unknown>;
    if (!isText(r.pk) || !isText(r.xpk) || !isText(r.rec) || !Number.isSafeInteger(r.e) || typeof r.active !== "number") return null;
    rows.push({ pk: r.pk, xpk: r.xpk, rec: r.rec, e: r.e as number, active: r.active, ...(typeof r.read_only === "number" ? { read_only: r.read_only } : {}) });
  }
  return rows;
}

function infoOf(v: unknown): Info | null {
  if (!v || typeof v !== "object") return null;
  const i = v as Record<string, unknown>;
  const sealed = (x: unknown): boolean => x === undefined || x === null || (!!x && typeof x === "object" && isText((x as Record<string, unknown>).iv) && isText((x as Record<string, unknown>).ct));
  if (!isText(i.ownerPk) || !isText(i.ownerXpk) || !isText(i.ownerSig) || !Number.isSafeInteger(i.epoch) || typeof i.rotate !== "boolean" || !sealed(i.settings) || !sealed(i.title)) return null;
  return v as Info;
}

export interface DaemonPresence {
  since: number;
  beaconMs: number;
  presence: { presence: Presence & { sigOk: boolean }; at: number }[];
}

export async function daemonPresence(channel: string, agent: string, sock = daemonSock()): Promise<DaemonPresence | null> {
  if (process.platform !== "win32" && !existsSync(sock)) return null;
  const ask = async (): Promise<DaemonPresence | null> => {
    const c = await openConn(sock, PEEK_MS);
    try {
      const r = await c.call("presence", { channel, as: agent });
      if (r.live !== true || typeof r.since !== "number" || typeof r.beaconMs !== "number" || !Array.isArray(r.presence)) return null;
      const presence = (r.presence as unknown[]).filter((h): h is DaemonPresence["presence"][number] => {
        const { presence: p, at } = (h ?? {}) as { presence?: { from?: unknown; sigOk?: unknown }; at?: unknown };
        return typeof at === "number" && !!p && typeof p.from === "string" && p.sigOk === true;
      });
      return { since: r.since, beaconMs: r.beaconMs, presence };
    } finally {
      c.close();
    }
  };
  return withDeadline(ask(), PEEK_MS).catch(() => null);
}

export async function daemonPeek(channel: string, agent: string, room: string, sock = daemonSock()): Promise<DaemonPeek | null> {
  if (process.platform !== "win32" && !existsSync(sock)) return null;
  const ask = async (): Promise<DaemonPeek | null> => {
    const c = await openConn(sock, PEEK_MS);
    try {
      const r = await c.call("peek", { channel, as: agent, room });
      if (r.live !== true || typeof r.head !== "number" || !Number.isSafeInteger(r.head)) return null;
      return { head: r.head, members: memberRows(r.members), info: infoOf(r.info) };
    } finally {
      c.close();
    }
  };
  return withDeadline(ask(), PEEK_MS).catch(() => null);
}

export async function daemonMark(channel: string, agent: string, seq: number, sock = daemonSock()): Promise<boolean> {
  try {
    const c = await openConn(sock, PEEK_MS);
    try {
      await c.call("mark", { channel, as: agent, seq });
      return true;
    } finally {
      c.close();
    }
  } catch {
    return false;
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

export async function stopDaemon(sock = daemonSock(), dir?: string): Promise<void> {
  try {
    const c = await openConn(sock, 2_000, dir);
    try {
      await c.call("stop");
    } finally {
      c.close();
    }
  } catch {
    // Already gone; stopping nothing is stopping done.
  }
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
  mark(seq: number): Promise<void>;
}

export async function listenDaemon(channel: string, agent: string, cursor: number, opts: { sock?: string; signal?: AbortSignal; noSpawn?: boolean } & SideLines = {}): Promise<DaemonSubscription> {
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
