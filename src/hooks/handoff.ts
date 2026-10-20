import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { home } from "../config.ts";
import { appendRotated } from "../daemon/wake.ts";
import { createdAt, sessionMeta, threadOf, type SessionMeta } from "../rotate/codex.ts";
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

export function offerHandoff(cwd: string, from: string, by: string, now = Date.now()): void {
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

const within = (born: number, o: Offer) => born >= o.at - CLOCK_MS && born <= o.at + NEW_THREAD_MS;

function startedWith(rollout: string, o: Offer, mine: SessionMeta): string[] {
  const dir = dirname(rollout);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    // The new thread's own folder can't be listed: no thread can be shown to be the only one.
    return [];
  }
  return names.flatMap((n) => {
    const id = threadOf(n);
    const born = id ? createdAt(id) : null;
    if (!id || born === null || id === o.from || !within(born, o)) return [];
    const meta = sessionMeta(join(dir, n));
    return meta && meta.originator === mine.originator && meta.cwd === mine.cwd ? [id] : [];
  });
}

function note(what: string): void {
  try {
    appendRotated(join(home(), "rotate.log"), `${new Date().toISOString()} ${what}\n`);
  } catch {
    // The log only explains what happened; failing to write it changes nothing.
  }
}

export function takeHandoff(cwd: string, to: string, rollout: string, now = Date.now()): string | null {
  const file = where(cwd);
  const o = offered(file);
  const born = createdAt(to);
  if (!o || born === null || o.from === to || !within(born, o)) return null;
  const mine = sessionMeta(rollout);
  if (!mine || mine.originator !== o.by) return null;
  rmSync(file, { force: true });
  const started = startedWith(rollout, o, mine);
  if (started.length !== 1 || started[0] !== to) {
    note(`session ${o.from} stays: ${started.length} Codex threads started in ${cwd} right after its /new, so none takes its seats`);
    return null;
  }
  const moved = handSeats(o.from, to, "codex", now);
  note(`session ${o.from}: ${moved} seat(s) handed to ${to}`);
  return moved ? o.from : null;
}
