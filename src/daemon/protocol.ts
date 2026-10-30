import { join } from "node:path";
import type { Info, MemberRow } from "@kiwi/core/client.ts";
import { home } from "../config.ts";
import type { Reach } from "@kiwi/core/protocol.ts";
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
  | "stop";

export const DAEMON_PROTOCOL = 9;

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
  marks: boolean | null;
  at: number;
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
