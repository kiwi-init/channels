import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { SeatRecord } from "../config.ts";
import { processes, tmuxNow, type Proc } from "../loop/tmux.ts";

type Env = Record<string, string | undefined>;

export const codexHome = (env: Env = process.env): string => env.CODEX_HOME || join(homedir(), ".codex");

export const codexControlSocket = (home: string): string => join(home, "app-server-control", "app-server-control.sock");

export async function codexRollout(home: string, thread: string): Promise<string | null> {
  const dbs = (existsSync(home) ? readdirSync(home) : []).filter((f) => /^state_\d+\.sqlite$/.test(f)).sort((a, b) => Number(/\d+/.exec(b)?.[0]) - Number(/\d+/.exec(a)?.[0]));
  const { Database } = await import("bun:sqlite");
  for (const f of dbs) {
    try {
      const db = new Database(join(home, f), { readonly: true });
      try {
        const row: unknown = db.query("SELECT rollout_path FROM threads WHERE id = ?").get(thread);
        const path = row && typeof row === "object" && "rollout_path" in row ? row.rollout_path : null;
        if (typeof path === "string" && existsSync(path)) return path;
      } finally {
        db.close();
      }
    } catch {
      // An index this Codex doesn't keep threads in: the next one may.
      continue;
    }
  }
  return null;
}

export type CodexLastTurn = { kind: "none" } | { kind: "running"; at: number; quietFor: number } | { kind: "done"; at: number } | { kind: "aborted"; at: number; turn: string };

function tail(file: string, bytes: number): string[] {
  const size = statSync(file).size;
  const len = Math.min(size, bytes);
  const buf = Buffer.alloc(len);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buf, 0, len, size - len);
  } finally {
    closeSync(fd);
  }
  return buf.toString("utf8").split("\n").reverse();
}

export function codexLastTurn(rollout: string, now = Date.now()): CodexLastTurn {
  for (const line of tail(rollout, 256 * 1024)) {
    if (!line.includes("task_started") && !line.includes("task_complete") && !line.includes("turn_aborted")) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      // A line cut by the tail's start: an older one may still say.
      continue;
    }
    if (!event || typeof event !== "object") continue;
    const at = "timestamp" in event && typeof event.timestamp === "string" ? Date.parse(event.timestamp) : Number.NaN;
    const payload = "payload" in event && event.payload && typeof event.payload === "object" ? event.payload : null;
    const type = payload && "type" in payload ? payload.type : null;
    if (!Number.isFinite(at)) continue;
    if (type === "turn_aborted") return { kind: "aborted", at, turn: payload && "turn_id" in payload && typeof payload.turn_id === "string" ? payload.turn_id : "" };
    if (type === "task_complete") return { kind: "done", at };
    if (type === "task_started") return { kind: "running", at, quietFor: now - statSync(rollout).mtimeMs };
  }
  return { kind: "none" };
}

export type CodexRestart = { kind: "restarted"; at: number } | { kind: "live"; at: number } | { kind: "unknown"; why: string };

const startOf = (p: Proc): number => Date.parse(`${p.start} GMT`);

const isCodex = (word: string, bin: string | undefined): boolean => basename(word) === "codex" || (!!bin && word === bin);

const runsCodex = (p: Proc, bin: string | undefined): boolean =>
  p.args
    .split(/\s+/)
    .slice(0, 2)
    .some((word) => isCodex(word, bin));

function exactArgv(pid: number): string[] | null {
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    return argv.at(-1) === "" ? argv.slice(0, -1) : argv;
  } catch {
    // No /proc (macOS) or the process is gone: its exact arguments can't be read, and ps loses their quoting.
    return null;
  }
}

const TAKES_VALUE = new Set([
  "-c",
  "--config",
  "--enable",
  "--disable",
  "--remote",
  "--remote-auth-token-env",
  "-m",
  "--model",
  "--local-provider",
  "-p",
  "--profile",
  "-s",
  "--sandbox",
  "-C",
  "--cd",
  "--add-dir",
  "-a",
  "--ask-for-approval",
]);
const FLAGS = new Set([
  "--all",
  "--include-non-interactive",
  "--strict-config",
  "--oss",
  "--approve-for-me",
  "--dangerously-bypass-approvals-and-sandbox",
  "--dangerously-bypass-hook-trust",
  "--worktree",
  "--search",
  "--no-alt-screen",
  "--no-daemon",
]);

export function resumedSession(args: readonly string[]): string | null {
  let resuming = false;
  for (let i = 0; i < args.length; i++) {
    const word = args[i];
    if (word === undefined) return null;
    if (word === "--") return resuming ? (args[i + 1] ?? null) : null;
    if (word.startsWith("-") && word !== "-") {
      const eq = word.indexOf("=");
      if (word.startsWith("--") && eq > 0) {
        if (!TAKES_VALUE.has(word.slice(0, eq))) return null;
      } else if (TAKES_VALUE.has(word)) i++;
      else if (/^-[cmpsCa]./.test(word)) continue;
      else if (!FLAGS.has(word)) return null;
      continue;
    }
    if (resuming) return word;
    if (word !== "resume") return null;
    resuming = true;
  }
  return null;
}

export function codexWindowRestart(record: SeatRecord, thread: string, abortedAt: number, procs: () => readonly Proc[] = processes): CodexRestart {
  if (!record.tmux) return { kind: "unknown", why: "Kiwi doesn't know which window runs this Codex session" };
  const panePid = Number(tmuxNow(record.tmux.socket, ["display-message", "-p", "-t", record.tmux.pane, "#{pane_pid}"])?.trim());
  if (!Number.isInteger(panePid) || panePid <= 1) return { kind: "unknown", why: "its tmux window is gone" };
  const all = procs();
  const inPane = new Set([panePid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of all)
      if (!inPane.has(p.pid) && inPane.has(p.ppid)) {
        inPane.add(p.pid);
        grew = true;
      }
  }
  const codexes = all.filter((p) => inPane.has(p.pid) && runsCodex(p, record.bin));
  if (!codexes.length) return { kind: "unknown", why: "no Codex runs in its tmux window" };
  const argvs = codexes.flatMap((p) => {
    const argv = exactArgv(p.pid);
    return argv ? [{ p, argv }] : [];
  });
  if (argvs.length < codexes.length) return { kind: "unknown", why: "the exact command line of the Codex in its tmux window can't be read here" };
  const starts = argvs
    .filter(({ argv }) => {
      const at = argv.slice(0, 2).findIndex((word) => isCodex(word, record.bin));
      return at >= 0 && resumedSession(argv.slice(at + 1)) === thread;
    })
    .map(({ p }) => startOf(p));
  if (!starts.length) return { kind: "unknown", why: "no Codex in its tmux window was started as codex resume of this thread" };
  if (starts.some((s) => !Number.isFinite(s))) return { kind: "unknown", why: "its Codex process's start time can't be read" };
  const started = Math.min(...starts);
  return Math.floor(started / 1000) > Math.floor(abortedAt / 1000) ? { kind: "restarted", at: started } : { kind: "live", at: started };
}

type RpcAnswer = { ok: true; result: unknown } | { ok: false; error: string };

type RpcCall = (method: string, params: Record<string, unknown>) => Promise<RpcAnswer>;

async function codexSession<T>(socket: string, work: (call: RpcCall) => Promise<T>, client = "kiwi", ms = 10_000): Promise<{ ok: true; value: T } | { ok: false; why: string }> {
  if (!existsSync(socket)) return { ok: false, why: "Codex's app-server isn't running (no control socket)" };
  const ws = new WebSocket(`ws+unix://${socket}`);
  const waiting = new Map<number, (a: RpcAnswer) => void>();
  let next = 1;
  let closed = false;
  const answered = <A>(work: Promise<A>, late: A): Promise<A> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return Promise.race([work, new Promise<A>((resolve) => (timer = setTimeout(() => resolve(late), ms)))]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  };
  const call: RpcCall = (method, params) => {
    if (closed) return Promise.resolve({ ok: false, error: "Kiwi closed its connection to Codex's app-server" });
    const id = next++;
    const reply = new Promise<RpcAnswer>((resolve) => {
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    return answered(reply, { ok: false, error: `no answer to ${method} in ${ms / 1000} s` });
  };
  ws.onmessage = (e) => {
    let m: unknown;
    try {
      m = JSON.parse(String(e.data));
    } catch {
      // Not JSON-RPC: nothing to match it to.
      return;
    }
    if (!m || typeof m !== "object" || !("id" in m) || typeof m.id !== "number") return;
    const done = waiting.get(m.id);
    if (!done) return;
    waiting.delete(m.id);
    const err = "error" in m && m.error && typeof m.error === "object" && "message" in m.error ? String(m.error.message) : null;
    done(err === null ? { ok: true, result: "result" in m ? m.result : null } : { ok: false, error: err });
  };
  try {
    const opened = new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
    });
    if (!(await answered(opened, false))) return { ok: false, why: "Codex's app-server refused the connection or didn't answer" };
    const hello = await call("initialize", { clientInfo: { name: client, version: "1" }, capabilities: { experimentalApi: true } });
    if (!hello.ok) return { ok: false, why: `Codex's app-server refused Kiwi: ${hello.error}` };
    ws.send(JSON.stringify({ method: "initialized" }));
    return { ok: true, value: await work(call) };
  } finally {
    closed = true;
    ws.close();
  }
}

export type CodexServing = { kind: "serving" } | { kind: "absent" } | { kind: "unknown"; why: string };

const LOADED_PAGES_MAX = 100;

function loadedPage(result: unknown): { data: string[]; nextCursor: string | null } | null {
  if (!result || typeof result !== "object" || !("data" in result) || !("nextCursor" in result)) return null;
  const { data, nextCursor } = result;
  if (!Array.isArray(data) || !data.every((t): t is string => typeof t === "string")) return null;
  if (nextCursor !== null && typeof nextCursor !== "string") return null;
  return { data, nextCursor };
}

async function codexLoaded(socket: string, thread: string): Promise<CodexServing> {
  const ran = await codexSession(
    socket,
    async (call): Promise<CodexServing> => {
      let cursor: string | null = null;
      for (let page = 0; page < LOADED_PAGES_MAX; page++) {
        const answer = await call("thread/loaded/list", cursor === null ? {} : { cursor });
        if (!answer.ok) return { kind: "unknown", why: `Codex's app-server didn't list its loaded threads: ${answer.error}` };
        const listed = loadedPage(answer.result);
        if (!listed) return { kind: "unknown", why: "Codex's app-server listed its loaded threads in a shape Kiwi doesn't read" };
        if (listed.data.includes(thread)) return { kind: "serving" };
        if (listed.nextCursor === null) return { kind: "absent" };
        cursor = listed.nextCursor;
      }
      return { kind: "unknown", why: `Codex's app-server listed more than ${LOADED_PAGES_MAX} pages of loaded threads` };
    },
    "kiwi-presence",
  );
  return ran.ok ? ran.value : { kind: "unknown", why: ran.why };
}

function codexClientSeen(thread: string, bin: string | undefined, procs: () => readonly Proc[]): boolean {
  return procs().some((p) => {
    if (!runsCodex(p, bin)) return false;
    const argv = exactArgv(p.pid);
    const at = argv ? argv.slice(0, 2).findIndex((word) => isCodex(word, bin)) : -1;
    return !!argv && at >= 0 && resumedSession(argv.slice(at + 1)) === thread;
  });
}

export async function codexServing(socket: string, thread: string, bin?: string, procs: () => readonly Proc[] = processes): Promise<CodexServing> {
  const loaded = await codexLoaded(socket, thread);
  if (loaded.kind === "serving" || codexClientSeen(thread, bin, procs)) return { kind: "serving" };
  return loaded;
}

export type QueueStart = { kind: "started" } | { kind: "abandoned"; why: string } | { kind: "failed"; why: string };

export async function startCodexQueue(socket: string, thread: string, stillOwed: () => Promise<string | null>): Promise<QueueStart> {
  const ran = await codexSession(socket, async (call): Promise<QueueStart> => {
    const beforeResume = await stillOwed();
    if (beforeResume !== null) return { kind: "abandoned", why: beforeResume };
    const resumed = await call("thread/resume", { threadId: thread });
    if (!resumed.ok) return { kind: "failed", why: `Codex couldn't resume thread ${thread}: ${resumed.error}` };
    const beforeStart = await stillOwed();
    if (beforeStart !== null) return { kind: "abandoned", why: beforeStart };
    const started = await call("thread/queue/start", { threadId: thread });
    if (started.ok || /active or pending turn|queue is empty/i.test(started.error)) return { kind: "started" };
    return { kind: "failed", why: `Codex couldn't start thread ${thread}'s queue: ${started.error}` };
  });
  return ran.ok ? ran.value : { kind: "failed", why: ran.why };
}
