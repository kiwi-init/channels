export const CHECKPOINT_WINDOW_MS = 5 * 60_000;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const AT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const OCCURRENCE_RE = /^(\d{4}-\d{2}-\d{2})T(([01]\d|2[0-3]):[0-5]\d)$/;
const MAX_TZ = 64;

export interface CheckpointDaily {
  at: string;
  tz: string;
}

export interface Occurrence {
  id: string;
  due: number;
}

export const dailyAt = (x: unknown): x is string => typeof x === "string" && AT_RE.test(x);

export function timeZoneKnown(x: unknown): x is string {
  if (typeof x !== "string" || !x || x.length > MAX_TZ) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: x });
    return true;
  } catch {
    // Intl throws a RangeError for a zone it doesn't know: that's the answer, not a failure.
    return false;
  }
}

export const wellFormedDaily = (x: unknown): x is CheckpointDaily => {
  if (!x || typeof x !== "object") return false;
  const d = x as Record<string, unknown>;
  return Object.keys(d).length === 2 && dailyAt(d.at) && timeZoneKnown(d.tz);
};

const formats = new Map<string, Intl.DateTimeFormat>();

function formatIn(tz: string): Intl.DateTimeFormat {
  const known = formats.get(tz);
  if (known) return known;
  const made = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  formats.set(tz, made);
  return made;
}

interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

function wallAt(tz: string, t: number): Wall {
  const parts = Object.fromEntries(
    formatIn(tz)
      .formatToParts(new Date(t))
      .map((p) => [p.type, p.value]),
  );
  return { y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day), h: Number(parts.hour), mi: Number(parts.minute) };
}

const wallMs = (w: Wall): number => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);

const offsetAt = (tz: string, t: number): number => wallMs(wallAt(tz, t)) - Math.floor(t / MINUTE_MS) * MINUTE_MS;

export function localDate(tz: string, t: number): string {
  const w = wallAt(tz, t);
  return `${String(w.y).padStart(4, "0")}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

function firstAfterGap(tz: string, from: number, to: number): number {
  let lo = from;
  let hi = to;
  const before = offsetAt(tz, lo);
  while (hi - lo > MINUTE_MS) {
    const mid = lo + Math.floor((hi - lo) / 2 / MINUTE_MS) * MINUTE_MS;
    if (offsetAt(tz, mid) === before) lo = mid;
    else hi = mid;
  }
  return hi;
}

export function dueOn(date: string, at: string, tz: string): number | null {
  const dm = DATE_RE.exec(date);
  const am = AT_RE.exec(at);
  if (!dm || !am) return null;
  const wall: Wall = { y: Number(dm[1]), mo: Number(dm[2]), d: Number(dm[3]), h: Number(am[1]), mi: Number(am[2]) };
  const naive = wallMs(wall);
  const offsets = new Set([offsetAt(tz, naive - DAY_MS), offsetAt(tz, naive + DAY_MS)]);
  const fits = [...offsets].map((o) => naive - o).filter((t) => wallMs(wallAt(tz, t)) === naive);
  if (fits.length) return Math.min(...fits);
  const ends = [...offsets].map((o) => naive - o);
  return firstAfterGap(tz, Math.min(...ends), Math.max(...ends));
}

export const occurrenceId = (date: string, at: string): string => `${date}T${at}`;

export function parseOccurrence(id: unknown): { date: string; at: string } | null {
  if (typeof id !== "string") return null;
  const m = OCCURRENCE_RE.exec(id);
  return m ? { date: m[1]!, at: m[2]! } : null;
}

export function nextOccurrence(daily: CheckpointDaily, after: number): Occurrence {
  const today = localDate(daily.tz, after);
  for (let i = 0; ; i++) {
    const date = localDate(daily.tz, Date.parse(`${today}T12:00:00Z`) + (i - 1) * DAY_MS);
    const due = dueOn(date, daily.at, daily.tz);
    if (due !== null && due > after) return { id: occurrenceId(date, daily.at), due };
  }
}

export function occurrenceDue(daily: CheckpointDaily, id: string): number | null {
  const o = parseOccurrence(id);
  if (!o || o.at !== daily.at) return null;
  return dueOn(o.date, o.at, daily.tz);
}

export function withinWindow(daily: CheckpointDaily, id: string, at: number): boolean {
  const due = occurrenceDue(daily, id);
  return due !== null && at >= due && at < due + CHECKPOINT_WINDOW_MS;
}

export type MissedWhy = "nobody online" | "nobody answered" | "relay asleep";

export type OccurrenceRecord = { id: string; due: number; state: "open" } | { id: string; due: number; state: "answered"; seq: number } | { id: string; due: number; state: "missed"; why: MissedWhy };

export interface CheckpointView {
  daily: CheckpointDaily | null;
  next: Occurrence | null;
  log: OccurrenceRecord[];
}

const MISSED_WHYS: readonly unknown[] = ["nobody online", "nobody answered", "relay asleep"];

function readRecord(x: unknown): OccurrenceRecord | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (parseOccurrence(r.id) === null || !Number.isSafeInteger(r.due)) return null;
  const base = { id: r.id as string, due: r.due as number };
  if (r.state === "open") return { ...base, state: "open" };
  if (r.state === "answered" && Number.isSafeInteger(r.seq)) return { ...base, state: "answered", seq: r.seq as number };
  if (r.state === "missed" && MISSED_WHYS.includes(r.why)) return { ...base, state: "missed", why: r.why as MissedWhy };
  return null;
}

export function readCheckpointView(x: unknown): CheckpointView | null {
  if (!x || typeof x !== "object") return null;
  const v = x as Record<string, unknown>;
  const n = v.next as Record<string, unknown> | null;
  const next = n && parseOccurrence(n.id) !== null && Number.isSafeInteger(n.due) ? { id: n.id as string, due: n.due as number } : null;
  return {
    daily: wellFormedDaily(v.daily) ? v.daily : null,
    next,
    log: Array.isArray(v.log) ? v.log.flatMap((r) => readRecord(r) ?? []) : [],
  };
}
