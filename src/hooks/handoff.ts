import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { home } from "../config.ts";
import { createdAt, originator } from "../rotate/codex.ts";
import { handSeats } from "../seats.ts";

export const NEW_THREAD_MS = 15_000;
const CLOCK_MS = 1_000;

function where(cwd: string): string {
  let dir = cwd;
  try {
    dir = realpathSync(cwd);
  } catch {
    // A folder that can't be resolved is keyed as given: the hook then misses it, and the seat stays.
  }
  return join(home(), "hook-state", `codex-handoff.${encodeURIComponent(dir)}`);
}

export function offerHandoff(cwd: string, from: string, by: string | null, now = Date.now()): void {
  mkdirSync(join(home(), "hook-state"), { recursive: true, mode: 0o700 });
  writeFileSync(where(cwd), JSON.stringify({ from, by, at: now }), { mode: 0o600 });
}

type Offer = { from: string; by: string; at: number };

function offered(file: string): Offer | null {
  try {
    const o = JSON.parse(readFileSync(file, "utf8")) as { from?: unknown; by?: unknown; at?: unknown };
    return typeof o.from === "string" && o.from && typeof o.by === "string" && o.by && typeof o.at === "number" ? { from: o.from, by: o.by, at: o.at } : null;
  } catch {
    // No handoff offered for this folder, or one cut mid-write: nothing to take.
    return null;
  }
}

export function takeHandoff(cwd: string, to: string, rollout: string, now = Date.now()): string | null {
  const file = where(cwd);
  const o = offered(file);
  const born = createdAt(to);
  if (!o || born === null || o.from === to) return null;
  if (born < o.at - CLOCK_MS || born > o.at + NEW_THREAD_MS || originator(rollout) !== o.by) return null;
  rmSync(file, { force: true });
  return handSeats(o.from, to, "codex", now) ? o.from : null;
}
