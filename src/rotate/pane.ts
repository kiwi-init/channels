import { spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { home } from "../config.ts";
import { appendRotated } from "../daemon/wake.ts";
import { alive } from "../hooks/listeners.ts";

export interface Target {
  pid: number;
  session: string;
  pane: string;
  socket: string;
  claudeDir: string;
}

export type Outcome = "cleared" | "gone" | "moved" | "not-its-pane" | "busy-elsewhere" | "timed-out" | "no-tmux" | "send-failed" | "left-in-input" | "switched-off";

const PROMPT = "❯";
const CLEAR = "/clear";
const RULE = /^─{8,}$/;
const FOOTER_LINES = 3;

const plain = (line: string) => line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/ /g, " ");

export function inputText(captured: string, footer: number | null = FOOTER_LINES): string | null {
  const lines = captured.split("\n");
  const rules = lines.flatMap((l, i) => (RULE.test(plain(l).trim()) ? [i] : []));
  const bottom = rules.at(-1);
  const top = rules.at(-2);
  if (bottom === undefined || top === undefined || bottom - top < 2) return null;
  if (footer !== null && lines.slice(bottom + 1).filter((l) => plain(l).trim()).length > footer) return null;
  const region = lines.slice(top + 1, bottom);
  const first = plain(region[0] ?? "").trimStart();
  if (!first.startsWith(PROMPT)) return null;
  return region
    .map((l, i) => {
      const shown = plain(l.replace(/\x1b\[2m[^\x1b]*\x1b\[0m/g, ""));
      return i === 0 ? shown.trimStart().slice(PROMPT.length) : shown;
    })
    .join("\n")
    .trim();
}

export function calm(activity: readonly number[], now: number, quietMs: number): boolean {
  return activity.every((at) => now - at * 1000 > quietMs);
}

type Registry = { kind: "gone" } | { kind: "seen"; session: string | null; idle: boolean };

function registry(t: Target): Registry {
  const file = join(t.claudeDir, "sessions", `${t.pid}.json`);
  if (!existsSync(file) || !alive(t.pid)) return { kind: "gone" };
  try {
    const r = JSON.parse(readFileSync(file, "utf8")) as { sessionId?: unknown; status?: unknown };
    return { kind: "seen", session: typeof r.sessionId === "string" ? r.sessionId : null, idle: r.status === "idle" };
  } catch {
    // Caught mid-write: read again on the next round.
    return { kind: "seen", session: null, idle: false };
  }
}

function tmux(t: Target, args: string[]): string | null {
  const r = spawnSync("tmux", ["-S", t.socket, ...args], { encoding: "utf8", timeout: 5_000 });
  return r.status === 0 ? r.stdout : null;
}

interface PaneId {
  server: string;
  panePid: string;
  tty: string;
}

function paneId(t: Target): PaneId | null {
  const out = tmux(t, ["display-message", "-p", "-t", t.pane, "#{pid} #{pane_pid} #{pane_tty}"])?.trim().split(" ");
  return out && out.length === 3 ? { server: out[0]!, panePid: out[1]!, tty: out[2]! } : null;
}

function holdsInput(pid: number, tty: string): boolean {
  const r = spawnSync("ps", ["-o", "tty=,tpgid=,pgid=", "-p", String(pid)], { encoding: "utf8", timeout: 2_000 });
  const [own, fg, group] = r.status === 0 ? r.stdout.trim().split(/\s+/) : [];
  return !!own && own !== "?" && tty.endsWith(`/${own.replace(/^\/dev\//, "")}`) && fg === String(pid) && group === String(pid);
}

type Check = Outcome | "wait" | "ready";

function check(t: Target, first: PaneId, quietMs: number, on: () => boolean, input: (captured: string) => boolean): Check {
  if (!on()) return "switched-off";
  const r = registry(t);
  if (r.kind === "gone") return "gone";
  if (r.session !== null && r.session !== t.session) return "moved";
  const now = paneId(t);
  if (now === null) return "no-tmux";
  if (now.server !== first.server || now.panePid !== first.panePid || now.tty !== first.tty) return "not-its-pane";
  if (!holdsInput(t.pid, now.tty)) return "wait";
  if (r.session === null || !r.idle) return "wait";
  const clients = tmux(t, ["list-clients", "-t", t.pane, "-F", "#{client_activity}"]);
  if (clients === null) return "no-tmux";
  const activity = clients
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => Number(l.trim()));
  if (!calm(activity, Date.now(), quietMs)) return "wait";
  const captured = tmux(t, ["capture-pane", "-p", "-e", "-t", t.pane]);
  if (captured === null) return "no-tmux";
  return input(captured) ? "ready" : "wait";
}

const empty = (captured: string) => inputText(captured) === "";
const typedClear = (captured: string) => inputText(captured, null) === CLEAR;
const endsWithClear = (captured: string) => inputText(captured, null)?.endsWith(CLEAR) === true;

function log(t: Target, what: string): void {
  try {
    appendRotated(join(home(), "rotate.log"), `${new Date().toISOString()} pid ${t.pid} session ${t.session} pane ${t.pane}: ${what}\n`);
  } catch {
    // The log only explains what happened; failing to write it changes nothing.
  }
}

function lockFile(session: string): string {
  return join(home(), "hook-state", `${encodeURIComponent(session)}.rotating`);
}

function holder(file: string): number | null {
  try {
    const pid = Number(readFileSync(file, "utf8"));
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function rotating(session: string): boolean {
  const pid = holder(lockFile(session));
  return pid !== null && alive(pid);
}

function link(from: string, to: string): boolean {
  try {
    linkSync(from, to);
    return true;
  } catch {
    // Already there: someone else holds it.
    return false;
  }
}

export function takeLock(session: string, me = process.pid): boolean {
  const lock = lockFile(session);
  mkdirSync(join(home(), "hook-state"), { recursive: true, mode: 0o700 });
  const mine = `${lock}.${me}.new`;
  writeFileSync(mine, String(me), { mode: 0o600 });
  try {
    if (link(mine, lock)) return true;
    const held = holder(lock);
    if (held === null || alive(held)) return false;
    const stale = `${lock}.${me}.stale`;
    try {
      renameSync(lock, stale);
    } catch {
      // Another sender moved it first: whoever links next holds it.
      return link(mine, lock);
    }
    const moved = holder(stale);
    if (moved !== null && moved !== held && alive(moved)) {
      link(stale, lock);
      rmSync(stale, { force: true });
      return false;
    }
    rmSync(stale, { force: true });
    return link(mine, lock);
  } finally {
    rmSync(mine, { force: true });
  }
}

export function dropLock(session: string, me = process.pid): void {
  if (holder(lockFile(session)) === me) rmSync(lockFile(session), { force: true });
}

const RENDER_MS = 1_000;
const RENDER_EVERY_MS = 50;

async function shown(t: Target, first: PaneId, quietMs: number, on: () => boolean): Promise<Check> {
  const end = Date.now() + RENDER_MS;
  for (;;) {
    const typed = check(t, first, quietMs, on, typedClear);
    if (typed !== "wait" || Date.now() >= end) return typed;
    await Bun.sleep(RENDER_EVERY_MS);
  }
}

export interface ClearOptions {
  timeoutMs?: number;
  everyMs?: number;
  quietMs?: number;
  on?: () => boolean;
}

export async function clearWhenIdle(t: Target, o: ClearOptions = {}): Promise<Outcome> {
  const timeoutMs = o.timeoutMs ?? 15 * 60_000;
  const everyMs = o.everyMs ?? 2_000;
  const quietMs = o.quietMs ?? 10_000;
  const on = o.on ?? (() => true);
  const first = paneId(t);
  if (first === null) return finish(t, "no-tmux");
  if (!holdsInput(t.pid, first.tty)) return finish(t, "not-its-pane");
  if (!takeLock(t.session)) return finish(t, "busy-elsewhere");
  try {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const before = check(t, first, quietMs, on, empty);
      if (before !== "wait" && before !== "ready") return finish(t, before);
      if (before === "ready") {
        if (tmux(t, ["send-keys", "-t", t.pane, "-l", CLEAR]) === null) return finish(t, "send-failed");
        const typed = await shown(t, first, quietMs, on);
        if (typed === "ready") return finish(t, tmux(t, ["send-keys", "-t", t.pane, "Enter"]) === null ? "send-failed" : "cleared");
        if (typed !== "wait" && typed !== "switched-off") return finish(t, typed);
        const captured = tmux(t, ["capture-pane", "-p", "-e", "-t", t.pane]);
        if (captured === null || !endsWithClear(captured)) return finish(t, "left-in-input");
        if (tmux(t, ["send-keys", "-t", t.pane, "-N", String(CLEAR.length), "BSpace"]) === null) return finish(t, "send-failed");
        if (typed === "switched-off") return finish(t, typed);
      }
      await Bun.sleep(everyMs);
    }
    return finish(t, "timed-out");
  } finally {
    dropLock(t.session);
  }
}

function finish(t: Target, outcome: Outcome): Outcome {
  log(t, outcome);
  return outcome;
}
