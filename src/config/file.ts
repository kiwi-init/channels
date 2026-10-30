import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { keepHeld } from "@kiwi/core/client.ts";
import { keepSeen, type ChannelAccess } from "@kiwi/core/crypto.ts";
import type { RexPlace, TerminalId, TerminalPlace, TmuxPlace } from "../terminals/plugin.ts";
import { home, writePrivate } from "./paths.ts";

export interface ChannelConfig extends ChannelAccess {
  relay: string;
  code: string;
  as?: string;
  owner?: string;
  person?: string;
  title?: string;
}

interface SeatHold {
  key: string;
  at: number;
  holder?: { pid: number; started: string };
}

export interface SeatRecord {
  alias: string;
  as: string;
  harness?: "claude" | "codex" | "gemini" | "cursor" | "grok" | "opencode" | "kimi" | "mimo" | "grok-bot" | "pi" | "zcode";
  session?: string;
  harnessSession?: string;
  pid?: number;
  at?: number;
  seen?: number;
  plain?: true;
  model?: string;
  term?: TerminalPlace;
  rex?: RexPlace;
  tmux?: TmuxPlace;
  hold?: SeatHold;
  holds?: number;
  loop?: true;
}

export function allSeats(cfg: Pick<Config, "bindings">): SeatRecord[] {
  return Object.values(cfg.bindings ?? {}).flatMap((v) => (Array.isArray(v) ? v : [v]));
}

export function dropSeats(cfg: Config, drop: (b: SeatRecord) => boolean): void {
  for (const [dir, v] of Object.entries(cfg.bindings ?? {})) {
    const kept = (Array.isArray(v) ? v : [v]).filter((b) => !drop(b));
    if (!kept.length) delete cfg.bindings![dir];
    else cfg.bindings![dir] = kept.length === 1 ? kept[0]! : kept;
  }
}

interface PendingJoin {
  code: string;
  relay: string;
  as: string;
  alias: string;
  requestId: string;
}

export interface Config {
  default?: string;
  channels: Record<string, ChannelConfig>;
  pending?: Record<string, PendingJoin>;
  asking?: Record<string, { as: string; at: number }>;
  bindings?: Record<string, SeatRecord | SeatRecord[]>;
  claudeHooks?: "on" | "off";
  harnessHooks?: Partial<Record<"codex" | "gemini" | "cursor" | "grok" | "kimi" | "pi" | "mimo" | "zcode", "on" | "off">>;
  zcodeHooksTurnedOn?: string[];
  wakeOff?: string[];
  wakeHooks?: Record<string, WakeHook>;
  contextLine?: "on" | "off";
  rex?: "on" | "off";
  launch?: "on" | "off";
  launchRoots?: string[];
  remoteBypass?: "on" | "off";
  terminals?: Terminals;
}

interface Terminals {
  helpers?: Partial<Record<TerminalId, "on" | "off">>;
}

function migrated(cfg: Config): Config {
  if (cfg.rex === undefined) return cfg;
  const { rex, ...rest } = cfg;
  const terminals = rest.terminals ?? {};
  return { ...rest, terminals: { ...terminals, helpers: { rex, ...terminals.helpers } } };
}

export interface WakeHook {
  url: string;
  authorization?: string;
}

export function loadConfig(): Config {
  const path = join(home(), "config.json");
  if (!existsSync(path)) return { channels: {} };
  const text = readFileSync(path, "utf8");
  try {
    return migrated(JSON.parse(text) as Config);
  } catch (err) {
    // A bare parse error names no file; say which one and what to do with it.
    throw new Error(`${path} isn't valid JSON (${err instanceof Error ? err.message : String(err)}): fix it, or move it aside and join your channels again`, { cause: err });
  }
}

export function saveConfig(cfg: Config): void {
  writePrivate(join(home(), "config.json"), JSON.stringify(cfg, null, 2) + "\n");
}

export function updateConfig(change: (cfg: Config) => void): Config {
  mkdirSync(home(), { recursive: true, mode: 0o700 });
  return withLock(join(home(), "config.lock"), () => {
    const cfg = loadConfig();
    change(cfg);
    saveConfig(cfg);
    return cfg;
  });
}

const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 30_000;
const LOCK_UNWRITTEN_MS = 2_000;

function lockOwner(lock: string): { token: string; pid: number } | null {
  try {
    const token = readFileSync(join(lock, "owner"), "utf8");
    const pid = Number(token.split(":")[0]);
    return Number.isInteger(pid) && pid > 0 ? { token, pid } : null;
  } catch {
    return null;
  }
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function abandoned(lock: string): boolean {
  let age: number;
  try {
    age = Date.now() - statSync(lock).mtimeMs;
  } catch {
    return false;
  }
  const owner = lockOwner(lock);
  if (!owner) return age > LOCK_UNWRITTEN_MS;
  return !running(owner.pid) || age > LOCK_STALE_MS;
}

export function withLock<T>(lock: string, fn: () => T, waitMs = LOCK_WAIT_MS): T {
  const token = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "owner"), token);
      break;
    } catch {
      if (abandoned(lock)) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`couldn't lock ${lock}; if no kiwi is running, delete it`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
  try {
    return fn();
  } finally {
    if (lockOwner(lock)?.token === token) rmSync(lock, { recursive: true, force: true });
  }
}

export function saveAccess(alias: string, access: ChannelAccess): void {
  updateConfig((cfg) => {
    const c = cfg.channels[alias];
    if (c) cfg.channels[alias] = { ...c, ...keepHeld(c, access), ...keepSeen(c, access), ...(access.signedTitle ? { signedTitle: true } : {}) };
  });
}
