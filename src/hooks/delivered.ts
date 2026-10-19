import * as Effect from "effect/Effect";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession } from "../agent.ts";
import { Cursor, home } from "../config.ts";
import { alive } from "./listeners.ts";

function deliveredFile(alias: string, as: string, session: string): string {
  return join(home(), "listen-hooks", `${encodeURIComponent(alias)}.${encodeURIComponent(as)}.${encodeURIComponent(session)}.delivered`);
}

export function deliveredUpTo(alias: string, as: string, session: string): number {
  try {
    return Number(readFileSync(deliveredFile(alias, as, session), "utf8")) || 0;
  } catch {
    return 0;
  }
}

export function noteDelivered(alias: string, as: string, session: string, seq: number): void {
  mkdirSync(join(home(), "listen-hooks"), { recursive: true, mode: 0o700 });
  writeFileSync(deliveredFile(alias, as, session), String(Math.max(seq, deliveredUpTo(alias, as, session))));
}

function pendingFile(alias: string, as: string, session: string): string {
  return join(home(), "listen-hooks", `${encodeURIComponent(alias)}.${encodeURIComponent(as)}.${encodeURIComponent(session)}.pending`);
}

export function notePending(alias: string, as: string, session: string, token: string, seq: number): void {
  mkdirSync(join(home(), "listen-hooks"), { recursive: true, mode: 0o700 });
  writeFileSync(pendingFile(alias, as, session), JSON.stringify({ token, seq }));
}

function readPending(file: string): { token: string; seq: number } | null {
  try {
    const got: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof got !== "object" || got === null || !("token" in got) || !("seq" in got)) return null;
    return typeof got.token === "string" && typeof got.seq === "number" ? { token: got.token, seq: got.seq } : null;
  } catch {
    // No handoff waiting, or one we can't read: nothing to settle, so its messages are handed over again.
    return null;
  }
}

export function settlePending(alias: string, as: string, session: string, landed: string | null): void {
  const file = pendingFile(alias, as, session);
  const pending = readPending(file);
  if (pending && pending.token === landed) noteDelivered(alias, as, session, pending.seq);
  rmSync(file, { force: true });
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

export const commitDelivered = Effect.fn("Hooks.commitDelivered")(function* (s: AgentSession, session: string) {
  const upTo = deliveredUpTo(s.alias, s.me, session);
  if (!upTo) return;
  const cursor = yield* Cursor;
  if (((yield* cursor.read(s.alias, s.me)) ?? 0) < upTo) yield* cursor.write(s.alias, s.me, upTo);
  rmSync(deliveredFile(s.alias, s.me, session), { force: true });
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
