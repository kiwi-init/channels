import { readFileSync } from "node:fs";
import { join } from "node:path";
import { home, writePrivate } from "../config.ts";

export interface RunningSeat {
  alias: string;
  as: string;
}

interface Sample {
  boot: string;
  at: number;
  seats: RunningSeat[];
}

interface RunningFile extends Sample {
  misses: Record<string, number>;
  previous?: Sample;
}

const DROP_AFTER_MISSES = 2;

const keyOf = (s: RunningSeat): string => `${s.alias}\u0000${s.as}`;

const fileOf = (dir: string): string => join(dir, "running.json");

function seatsFrom(v: unknown): RunningSeat[] | null {
  if (!Array.isArray(v)) return null;
  const seats = v.flatMap((s): RunningSeat[] =>
    typeof s === "object" && s !== null && "alias" in s && "as" in s && typeof s.alias === "string" && typeof s.as === "string" ? [{ alias: s.alias, as: s.as }] : [],
  );
  return seats.length === v.length ? seats : null;
}

function sampleFrom(v: unknown): Sample | null {
  if (typeof v !== "object" || v === null || !("boot" in v) || !("at" in v) || !("seats" in v)) return null;
  const seats = seatsFrom(v.seats);
  return typeof v.boot === "string" && typeof v.at === "number" && seats ? { boot: v.boot, at: v.at, seats } : null;
}

function missesFrom(v: unknown): Record<string, number> {
  if (typeof v !== "object" || v === null) return {};
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === "number"));
}

export function readRunning(dir: string = home()): RunningFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(fileOf(dir), "utf8"));
  } catch {
    // No file yet (no daemon has sampled on this computer), or a torn one: no evidence.
    return null;
  }
  const sample = sampleFrom(raw);
  if (!sample || typeof raw !== "object" || raw === null) return null;
  const previous = "previous" in raw ? sampleFrom(raw.previous) : null;
  return { ...sample, misses: "misses" in raw ? missesFrom(raw.misses) : {}, ...(previous ? { previous } : {}) };
}

export function nextRunning(file: RunningFile | null, boot: string, alive: readonly RunningSeat[], now: number): RunningFile {
  if (!file || file.boot !== boot) {
    const previous = file ? { boot: file.boot, at: file.at, seats: file.seats } : undefined;
    return { boot, at: now, seats: [...alive], misses: {}, ...(previous ? { previous } : {}) };
  }
  const here = new Set(alive.map(keyOf));
  const misses: Record<string, number> = {};
  const kept = file.seats.filter((s) => {
    if (here.has(keyOf(s))) return true;
    const missed = (file.misses[keyOf(s)] ?? 0) + 1;
    if (missed >= DROP_AFTER_MISSES) return false;
    misses[keyOf(s)] = missed;
    return true;
  });
  const known = new Set(kept.map(keyOf));
  return { boot, at: now, seats: [...kept, ...alive.filter((s) => !known.has(keyOf(s)))], misses, ...(file.previous ? { previous: file.previous } : {}) };
}

export function noteRunning(dir: string, boot: string, alive: readonly RunningSeat[], now = Date.now()): void {
  writePrivate(fileOf(dir), JSON.stringify(nextRunning(readRunning(dir), boot, alive, now)));
}

export function beforeThisBoot(file: RunningFile | null, boot: string): Sample | null {
  if (!file) return null;
  if (file.boot !== boot) return { boot: file.boot, at: file.at, seats: file.seats };
  return file.previous ?? null;
}
