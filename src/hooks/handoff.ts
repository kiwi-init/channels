import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { home } from "../config.ts";
import { handSeats } from "../seats.ts";

export const HANDOFF_MS = 10 * 60_000;

function where(cwd: string): string {
  let dir = cwd;
  try {
    dir = realpathSync(cwd);
  } catch {
    // A folder that can't be resolved is keyed as given: the hook then misses it, and the seat stays.
  }
  return join(home(), "hook-state", `codex-handoff.${encodeURIComponent(dir)}`);
}

export function offerHandoff(cwd: string, from: string, now = Date.now()): void {
  mkdirSync(join(home(), "hook-state"), { recursive: true, mode: 0o700 });
  writeFileSync(where(cwd), JSON.stringify({ from, at: now }), { mode: 0o600 });
}

function offered(file: string): { from: string; at: number } | null {
  try {
    const o = JSON.parse(readFileSync(file, "utf8")) as { from?: unknown; at?: unknown };
    return typeof o.from === "string" && o.from && typeof o.at === "number" ? { from: o.from, at: o.at } : null;
  } catch {
    // No handoff offered for this folder, or one cut mid-write: nothing to take.
    return null;
  }
}

export function takeHandoff(cwd: string, to: string, now = Date.now()): string | null {
  const file = where(cwd);
  const o = offered(file);
  if (!o) return null;
  rmSync(file, { force: true });
  if (o.from === to || now - o.at > HANDOFF_MS || now < o.at) return null;
  return handSeats(o.from, to, "codex", now) ? o.from : null;
}
