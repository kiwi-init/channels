import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { descendsFrom } from "../ancestry.ts";
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

export type Outcome = "cleared" | "gone" | "moved" | "not-its-pane" | "busy-elsewhere" | "timed-out" | "no-tmux";

const PROMPT = "❯";

export function inputEmpty(captured: string): boolean | null {
  const line = captured.split("\n").findLast((l) => l.includes(PROMPT));
  if (line === undefined) return null;
  const typed = line
    .slice(line.lastIndexOf(PROMPT) + PROMPT.length)
    .replace(/\x1b\[2m[^\x1b]*\x1b\[0m/g, "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/[\s ]+/g, "");
  return typed === "";
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

function quiet(t: Target, quietMs: number, now: number): boolean | null {
  const clients = tmux(t, ["list-clients", "-t", t.pane, "-F", "#{client_activity}"]);
  if (clients === null) return null;
  return clients
    .split("\n")
    .filter((l) => l.trim())
    .every((l) => now - Number(l.trim()) * 1000 > quietMs);
}

function ready(t: Target, quietMs: number): Outcome | "wait" | "send" {
  const r = registry(t);
  if (r.kind === "gone") return "gone";
  if (r.session !== null && r.session !== t.session) return "moved";
  if (r.session === null || !r.idle) return "wait";
  const calm = quiet(t, quietMs, Date.now());
  if (calm === null) return "no-tmux";
  if (!calm) return "wait";
  const captured = tmux(t, ["capture-pane", "-p", "-e", "-t", t.pane]);
  if (captured === null) return "no-tmux";
  return inputEmpty(captured) === true ? "send" : "wait";
}

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

export function rotating(session: string): boolean {
  try {
    return alive(Number(readFileSync(lockFile(session), "utf8")));
  } catch {
    return false;
  }
}

export interface ClearOptions {
  timeoutMs?: number;
  everyMs?: number;
  quietMs?: number;
}

export async function clearWhenIdle(t: Target, o: ClearOptions = {}): Promise<Outcome> {
  const timeoutMs = o.timeoutMs ?? 15 * 60_000;
  const everyMs = o.everyMs ?? 2_000;
  const quietMs = o.quietMs ?? 10_000;
  const panePid = Number(tmux(t, ["display-message", "-p", "-t", t.pane, "#{pane_pid}"])?.trim());
  if (!Number.isInteger(panePid) || panePid <= 0) return finish(t, "no-tmux");
  if (!descendsFrom(t.pid, panePid)) return finish(t, "not-its-pane");
  if (rotating(t.session)) return finish(t, "busy-elsewhere");
  mkdirSync(join(home(), "hook-state"), { recursive: true, mode: 0o700 });
  writeFileSync(lockFile(t.session), String(process.pid));
  try {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const first = ready(t, quietMs);
      if (first === "send") {
        await Bun.sleep(Math.min(everyMs, 500));
        const again = ready(t, quietMs);
        if (again === "send") {
          tmux(t, ["send-keys", "-t", t.pane, "-l", "/clear"]);
          tmux(t, ["send-keys", "-t", t.pane, "Enter"]);
          return finish(t, "cleared");
        }
        if (again !== "wait") return finish(t, again);
      } else if (first !== "wait") return finish(t, first);
      await Bun.sleep(everyMs);
    }
    return finish(t, "timed-out");
  } finally {
    rmSync(lockFile(t.session), { force: true });
  }
}

function finish(t: Target, outcome: Outcome): Outcome {
  log(t, outcome);
  return outcome;
}
