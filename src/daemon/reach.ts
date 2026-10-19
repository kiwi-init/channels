import type { Config, SeatRecord } from "../config.ts";
import type { Activity, Reach } from "@kiwi/core/protocol.ts";
import { pidAlive } from "../seats.ts";
import { wakeKey } from "@kiwi/core/wake.ts";

type Env = Record<string, string | undefined>;

const HARNESS_ENV = [
  "CLAUDECODE",
  "CLAUDE_PID",
  "CLAUDE_CODE_SESSION_ID",
  "CODEX_THREAD_ID",
  "OPENCODE_SESSION_ID",
  "GROK_SESSION_ID",
  "GEMINI_CLI",
  "CURSOR_AGENT",
  "MIMOCODE",
  "MIMOCODE_PID",
] as const;

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
    case "pi":
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

export function wakeOn(cfg: Config, alias: string, agent: string): boolean {
  return !(cfg.wakeOff ?? []).includes(wakeKey(alias, agent));
}
