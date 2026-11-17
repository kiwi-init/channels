import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
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

const runsCodex = (p: Proc, bin: string | undefined): boolean =>
  p.args
    .split(/\s+/)
    .slice(0, 2)
    .some((word) => basename(word) === "codex" || (!!bin && word === bin));

export function codexWindowRestart(record: SeatRecord, abortedAt: number, procs: () => readonly Proc[] = processes): CodexRestart {
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
  const starts = all.filter((p) => inPane.has(p.pid) && runsCodex(p, record.bin)).map(startOf);
  if (!starts.length) return { kind: "unknown", why: "no Codex runs in its tmux window" };
  if (starts.some((s) => !Number.isFinite(s))) return { kind: "unknown", why: "its Codex process's start time can't be read" };
  const started = Math.min(...starts);
  return Math.floor(started / 1000) > Math.floor(abortedAt / 1000) ? { kind: "restarted", at: started } : { kind: "live", at: started };
}

interface RpcCall {
  method: string;
  params: Record<string, unknown>;
}

type RpcAnswer = { ok: true; result: unknown } | { ok: false; error: string };

export async function codexRpc(socket: string, calls: readonly RpcCall[], ms = 10_000): Promise<RpcAnswer[] | { failed: string }> {
  if (!existsSync(socket)) return { failed: "Codex's app-server isn't running (no control socket)" };
  const ws = new WebSocket(`ws+unix://${socket}`);
  const answers: RpcAnswer[] = [];
  const waiting = new Map<number, (a: RpcAnswer) => void>();
  const call = (id: number, method: string, params: Record<string, unknown>): Promise<RpcAnswer> =>
    new Promise((resolve) => {
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
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
  const talk = async (): Promise<RpcAnswer[] | { failed: string }> => {
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Codex's app-server refused the connection"));
    });
    const hello = await call(1, "initialize", { clientInfo: { name: "kiwi", version: "1" }, capabilities: { experimentalApi: true } });
    if (!hello.ok) return { failed: `Codex's app-server refused Kiwi: ${hello.error}` };
    ws.send(JSON.stringify({ method: "initialized" }));
    for (const [i, c] of calls.entries()) answers.push(await call(i + 2, c.method, c.params));
    return answers;
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const late = new Promise<{ failed: string }>((resolve) => {
    timer = setTimeout(() => resolve({ failed: `Codex's app-server didn't answer in ${ms / 1000} s` }), ms);
  });
  try {
    return await Promise.race([talk().catch((err: unknown) => ({ failed: err instanceof Error ? err.message : String(err) })), late]);
  } finally {
    if (timer) clearTimeout(timer);
    ws.close();
  }
}

export async function startCodexQueue(socket: string, thread: string): Promise<string | null> {
  const answers = await codexRpc(socket, [
    { method: "thread/resume", params: { threadId: thread } },
    { method: "thread/queue/start", params: { threadId: thread } },
  ]);
  if ("failed" in answers) return answers.failed;
  const [resumed, started] = answers;
  if (!resumed?.ok) return `Codex couldn't resume thread ${thread}: ${resumed?.error ?? "no answer"}`;
  if (started?.ok || /active or pending turn|queue is empty/i.test(started?.error ?? "")) return null;
  return `Codex couldn't start thread ${thread}'s queue: ${started?.error ?? "no answer"}`;
}
