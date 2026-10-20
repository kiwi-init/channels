import * as Effect from "effect/Effect";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession } from "../agent.ts";
import { Cursor, home } from "../config.ts";
import { alive } from "./listeners.ts";

function deliveredFile(alias: string, as: string, session: string): string {
  return join(home(), "listen-hooks", `${encodeURIComponent(alias)}.${encodeURIComponent(as)}.${encodeURIComponent(session)}.delivered`);
}

interface Delivered {
  seq: number;
  pid: number | null;
  seat: { alias: string; as: string } | null;
}

function readDelivered(file: string): Delivered | null {
  try {
    const fields = readFileSync(file, "utf8").trim().split(/\s+/);
    if (fields.length === 3 || fields.length > 4) return null;
    const [seqText, pidText, alias, as] = fields;
    const seq = Number(seqText);
    const pid = Number(pidText);
    if (!Number.isSafeInteger(seq) || seq <= 0) return null;
    return {
      seq,
      pid: Number.isSafeInteger(pid) && pid > 0 ? pid : null,
      seat: alias !== undefined && as !== undefined ? { alias: decodeURIComponent(alias), as: decodeURIComponent(as) } : null,
    };
  } catch {
    return null;
  }
}

function ofSeat(d: Delivered, alias: string, as: string): boolean {
  return d.seat === null || (d.seat.alias === alias && d.seat.as === as);
}

export function deliveredUpTo(alias: string, as: string, session: string): number {
  const d = readDelivered(deliveredFile(alias, as, session));
  return d && ofSeat(d, alias, as) ? d.seq : 0;
}

export function noteDelivered(alias: string, as: string, session: string, seq: number, pid?: number): void {
  mkdirSync(join(home(), "listen-hooks"), { recursive: true, mode: 0o700 });
  const upTo = Math.max(seq, deliveredUpTo(alias, as, session));
  writeFileSync(deliveredFile(alias, as, session), `${upTo} ${pid ?? 0} ${encodeURIComponent(alias)} ${encodeURIComponent(as)}`);
}

function deliveredFiles(alias: string, as: string, session: string, pid: number | undefined): { file: string; seq: number }[] {
  const own = deliveredFile(alias, as, session);
  if (!pid) {
    const seq = deliveredUpTo(alias, as, session);
    return seq ? [{ file: own, seq }] : [];
  }
  const dir = join(home(), "listen-hooks");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const file = join(dir, name);
    if (!name.endsWith(".delivered")) return [];
    const d = readDelivered(file);
    if (!d) return [];
    if (file === own) return ofSeat(d, alias, as) ? [{ file, seq: d.seq }] : [];
    return d.pid === pid && d.seat?.alias === alias && d.seat.as === as ? [{ file, seq: d.seq }] : [];
  });
}

export function deliveredInProcess(alias: string, as: string, session: string, pid?: number): number {
  return Math.max(0, ...deliveredFiles(alias, as, session, pid).map((d) => d.seq));
}

function pendingFile(alias: string, as: string, session: string, token: string): string {
  return join(home(), "listen-hooks", `${encodeURIComponent(alias)}.${encodeURIComponent(as)}.${encodeURIComponent(session)}.${encodeURIComponent(token)}.pending`);
}

export function notePending(alias: string, as: string, session: string, token: string, seq: number): void {
  mkdirSync(join(home(), "listen-hooks"), { recursive: true, mode: 0o700 });
  writeFileSync(pendingFile(alias, as, session, token), String(seq));
}

export function settlePending(alias: string, as: string, session: string, landed: string): number | null {
  const file = pendingFile(alias, as, session, landed);
  let seq: number;
  try {
    seq = Number(readFileSync(file, "utf8"));
  } catch {
    // No handoff under that token for this seat: nothing landed here to count as delivered.
    return null;
  }
  const settled = Number.isInteger(seq) && seq > 0 ? seq : 0;
  if (settled) noteDelivered(alias, as, session, settled);
  rmSync(file, { force: true });
  return settled;
}

const ANSWERING = ".answering";

function answeringDir(): string {
  return join(home(), "hook-state");
}

function answeringPrefix(session: string): string {
  return `${encodeURIComponent(session)}.`;
}

export function holdAnswering(session: string | undefined): () => void {
  if (!session) return () => {};
  const file = join(answeringDir(), `${answeringPrefix(session)}${process.pid}${ANSWERING}`);
  try {
    mkdirSync(answeringDir(), { recursive: true, mode: 0o700 });
    writeFileSync(file, String(process.pid));
  } catch {
    // Without the marker a listener may hand the same message over again: a repeat, never a loss.
    return () => {};
  }
  return () => rmSync(file, { force: true });
}

export function answeringNow(session: string | undefined): boolean {
  if (!session) return false;
  const prefix = answeringPrefix(session);
  let names: string[];
  try {
    names = readdirSync(answeringDir());
  } catch {
    return false;
  }
  let busy = false;
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(ANSWERING)) continue;
    const mid = name.slice(prefix.length, -ANSWERING.length);
    if (!/^\d+$/.test(mid)) continue;
    if (alive(Number(mid))) busy = true;
    else rmSync(join(answeringDir(), name), { force: true });
  }
  return busy;
}

export const commitDelivered = Effect.fn("Hooks.commitDelivered")(function* (s: AgentSession, session: string, pid?: number) {
  const files = deliveredFiles(s.alias, s.me, session, pid);
  const upTo = Math.max(0, ...files.map((d) => d.seq));
  if (!upTo) return;
  const cursor = yield* Cursor;
  if (((yield* cursor.read(s.alias, s.me)) ?? 0) < upTo) yield* cursor.write(s.alias, s.me, upTo);
  for (const { file } of files) rmSync(file, { force: true });
  yield* s.markRead(upTo);
});

const HEARD_KEEP = 400;

export interface Heard {
  alias: string;
  as: string;
  seq: number;
}

function heardFile(session: string): string {
  return join(home(), "listen-hooks", `${encodeURIComponent(session)}.heard`);
}

function readHeard(session: string): Heard[] {
  try {
    return readFileSync(heardFile(session), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Heard);
  } catch {
    return [];
  }
}

export function noteHeard(session: string | undefined, alias: string, as: string, seqs: readonly number[]): void {
  if (!session || !seqs.length) return;
  try {
    mkdirSync(join(home(), "listen-hooks"), { recursive: true, mode: 0o700 });
    const kept = [...readHeard(session), ...seqs.map((seq) => ({ alias, as, seq }))].slice(-HEARD_KEEP);
    writeFileSync(heardFile(session), kept.map((h) => JSON.stringify(h)).join("\n") + "\n");
  } catch {
    // Remembering what was shown only saves a flag later; failing to must never break showing it.
  }
}

export function heardFrom(session: string | undefined, seq: number): Heard[] {
  if (!session) return [];
  const seats = new Map<string, Heard>();
  for (const h of readHeard(session)) if (h.seq === seq) seats.set(`${h.alias}\0${h.as}`, h);
  return [...seats.values()];
}

export function pruneHookFiles(base: string, maxAgeMs: number, now = Date.now()): number {
  let pruned = 0;
  for (const dir of [join(base, "listen-hooks"), join(base, "hook-state")]) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const file = join(dir, name);
      try {
        if (!statSync(file).isFile() || now - statSync(file).mtimeMs <= maxAgeMs) continue;
        rmSync(file, { force: true });
        pruned += 1;
      } catch {
        // Gone already, or not ours to read: nothing to prune.
      }
    }
  }
  return pruned;
}
