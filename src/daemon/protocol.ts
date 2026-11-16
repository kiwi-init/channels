import { join } from "node:path";
import type { Info, MemberRow } from "@kiwi/core/client.ts";
import { home } from "../config.ts";
import { KEEP_MAX, type Reach, type Unarmed } from "@kiwi/core/protocol.ts";
import type { WakeCommand, WakePath } from "@kiwi/core/wake.ts";
import type { PairedPerson } from "./pair.ts";

export function daemonSock(dir = home()): string {
  if (process.platform === "win32") {
    const tag =
      dir
        .replace(/[^A-Za-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(-64) || "kiwi";
    return `\\\\.\\pipe\\kiwi-daemon-${tag}`;
  }
  return join(dir, "daemon.sock");
}

export function daemonToken(dir = home()): string {
  return join(dir, "daemon.token");
}

export type DaemonVerb =
  | "hello"
  | "adopt"
  | "admit"
  | "listen"
  | "listening"
  | "hold"
  | "listeners"
  | "unarmed"
  | "read"
  | "mark"
  | "peek"
  | "presence"
  | "harnesses"
  | "folders"
  | "launch"
  | "loop"
  | "term"
  | "mine"
  | "mine-tabs"
  | "mine-close"
  | "term-keys"
  | "term-size"
  | "unpair"
  | "keep"
  | "stop";

export const DAEMON_PROTOCOL = 9;

const ROOM_RE = /^[0-9a-f]{32}$/;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

export function readKeepAsk(params: Record<string, unknown>): { room: string; agents: { pk: string; from: string }[] } | null {
  const { room, agents } = params;
  if (typeof room !== "string" || !ROOM_RE.test(room) || !Array.isArray(agents) || !agents.length || agents.length > KEEP_MAX) return null;
  const read = agents.map((a: unknown) => {
    const { pk, from } = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
    return typeof pk === "string" && KEY_RE.test(pk) && typeof from === "string" && KEY_RE.test(from) ? { pk, from } : null;
  });
  return read.every((a) => a !== null) ? { room, agents: read } : null;
}

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
  proc: ListenerProc | null;
  marks: boolean | null;
  at: number;
}

export interface ListenerProc {
  pid: number;
  started: string;
}

export type ListenerHolder = Pick<DaemonListener, "session" | "pid" | "harness" | "proc">;

function readProc(v: unknown): ListenerProc | null {
  if (!v || typeof v !== "object") return null;
  const pid = "pid" in v ? v.pid : null;
  const started = "started" in v ? v.started : null;
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0 && typeof started === "string" && started ? { pid, started } : null;
}

export function readHolder(v: unknown): ListenerHolder | null {
  if (!v || typeof v !== "object") return null;
  const session = "session" in v && typeof v.session === "string" && v.session ? v.session : null;
  const harness = "harness" in v && typeof v.harness === "string" && v.harness ? v.harness : null;
  const pid = "pid" in v && typeof v.pid === "number" && Number.isInteger(v.pid) && v.pid > 0 ? v.pid : null;
  return { session, pid, harness, proc: "proc" in v ? readProc(v.proc) : null };
}

export interface ProcessLook {
  alive: (pid: number) => boolean;
  startOf: (pid: number) => string | null;
}

export function supersedes(by: DaemonListener, holder: DaemonListener, look: ProcessLook): boolean {
  if (!holder.proc) return false;
  if (by.proc && by.proc.pid === holder.proc.pid && by.proc.started === holder.proc.started) return true;
  if (!look.alive(holder.proc.pid)) return true;
  const started = look.startOf(holder.proc.pid);
  return started !== null && started !== holder.proc.started;
}

const optionalText = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function readListener(x: unknown): DaemonListener | null {
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
    proc: readProc(r.proc),
    marks: typeof r.marks === "boolean" ? r.marks : null,
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
  unarmed: Unarmed | null;
}

export interface DaemonPeek {
  head: number;
  members: MemberRow[] | null;
  info: Info | null;
}

export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
  });
  return Promise.race([work, late]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const DAEMON_EVENTS: readonly DaemonEvent[] = ["open", "roster", "info", "request"];
export const isDaemonEvent = (e: string): e is DaemonEvent => (DAEMON_EVENTS as readonly string[]).includes(e);
