import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ChannelAccess } from "../crypto.ts";
import { home, writePrivate } from "./paths.ts";

export interface ChannelConfig extends ChannelAccess {
  relay: string;
  code: string;
  as?: string;
  owner?: string;
  person?: string;
  title?: string;
}

export interface SeatRecord {
  alias: string;
  as: string;
  harness?: "claude" | "codex" | "gemini" | "cursor" | "grok" | "opencode" | "kimi" | "mimo";
  session?: string;
  pid?: number;
  at?: number;
  seen?: number;
  plain?: true;
  model?: string;
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
  harnessHooks?: Partial<Record<"codex" | "gemini" | "cursor" | "grok" | "kimi", "on" | "off">>;
  wakeOff?: string[];
}

export function loadConfig(): Config {
  const path = join(home(), "config.json");
  if (!existsSync(path)) return { channels: {} };
  return JSON.parse(readFileSync(path, "utf8")) as Config;
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

export function withLock<T>(lock: string, fn: () => T): T {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        const age = Date.now() - statSync(lock).mtimeMs;
        if (age > 5_000) rmSync(lock, { recursive: true, force: true });
      } catch {}
      if (Date.now() > deadline) throw new Error(`couldn't lock ${lock}; if no kiwi is running, delete it`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

export function saveAccess(alias: string, access: ChannelAccess): void {
  updateConfig((cfg) => {
    const c = cfg.channels[alias];
    if (c) cfg.channels[alias] = { ...c, epoch: access.epoch, keys: { ...c.keys, ...access.keys }, ...(access.signedTitle ? { signedTitle: true } : {}) };
  });
}
