import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { home } from "../config.ts";
import { appendRotated } from "../daemon/wake.ts";
import { codexTurn } from "../harness.ts";
import { offerHandoff } from "../hooks/handoff.ts";
import { alive } from "../hooks/listeners.ts";
import { CODEX_FIRST, CODEX_NEW, codexInput, codexShown, sameWords } from "./codex.ts";

interface Seat {
  pid: number;
  session: string;
  pane: string;
  socket: string;
}

export type Thread = { kind: "old"; rollout: string; name: string; by: string } | { kind: "fresh" };

export type Target = (Seat & { harness: "claude"; claudeDir: string }) | (Seat & { harness: "codex"; cwd: string; thread: Thread });

export type Outcome =
  | "cleared"
  | "new-without-prompt"
  | "gone"
  | "moved"
  | "not-its-pane"
  | "not-its-thread"
  | "busy-elsewhere"
  | "timed-out"
  | "no-tmux"
  | "send-failed"
  | "left-in-input"
  | "switched-off";

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
  if (t.harness === "codex") {
    if (!alive(t.pid)) return { kind: "gone" };
    if (t.thread.kind === "fresh") return { kind: "seen", session: t.session, idle: true };
    return existsSync(t.thread.rollout) ? { kind: "seen", session: t.session, idle: codexTurn(t.thread.rollout)?.state === "idle" } : { kind: "gone" };
  }
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

function showsThread(t: Target): Check {
  if (t.harness !== "codex") return "ready";
  const title = tmux(t, ["display-message", "-p", "-t", t.pane, "#{pane_title}"]);
  if (title === null) return "no-tmux";
  const shown = codexShown(title.replace(/\n$/, ""));
  if (shown.kind === "busy") return "wait";
  if (t.thread.kind === "fresh") return shown.kind === "unnamed" ? "ready" : "wait";
  return shown.kind === "named" && shown.name === t.thread.name ? "ready" : "not-its-thread";
}

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
  const thread = showsThread(t);
  if (thread !== "ready") return thread;
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

const commandOf = (t: Target) => (t.harness === "codex" ? CODEX_NEW : CLEAR);
const typed = (t: Target, captured: string, confirming: boolean) => (t.harness === "codex" ? codexInput(captured, t.cwd) : inputText(captured, confirming ? null : FOOTER_LINES));
const empty = (t: Target) => (captured: string) => typed(t, captured, false) === "";
const shows = (t: Target, text: string) => (captured: string) => {
  const now = typed(t, captured, true);
  return now !== null && (t.harness === "codex" ? sameWords(now, text) : now === text);
};
const endsWith = (t: Target, text: string) => (captured: string) => {
  const now = typed(t, captured, true);
  return now !== null && (t.harness === "codex" ? now.replace(/\s+/g, " ").endsWith(text.replace(/\s+/g, " ")) : now.endsWith(text));
};

export type Teller = Pick<Target, "pid" | "session" | "pane">;

function log(t: Teller, what: string): boolean {
  try {
    appendRotated(join(home(), "rotate.log"), `${new Date().toISOString()} pid ${t.pid} session ${t.session} pane ${t.pane}: ${what}\n`);
    return true;
  } catch {
    // The log only explains what happened; failing to write it changes nothing.
    return false;
  }
}

function lockDir(): string {
  return join(home(), "hook-state");
}

function lockPrefix(session: string): string {
  return `${encodeURIComponent(session)}.rotating.`;
}

function holders(session: string): number[] {
  let names: string[];
  try {
    names = readdirSync(lockDir());
  } catch {
    return [];
  }
  const prefix = lockPrefix(session);
  return names.flatMap((n) => {
    const pid = Number(n.slice(prefix.length));
    return n.startsWith(prefix) && Number.isSafeInteger(pid) && pid > 0 ? [pid] : [];
  });
}

function stayFile(session: string): string {
  return join(lockDir(), `${encodeURIComponent(session)}.rotate-stay`);
}

export function noteStay(t: Teller, seat: string, why: string): void {
  const said = `stays (${seat}): ${why}`;
  try {
    if (readFileSync(stayFile(t.session), "utf8") === said) return;
  } catch {
    // No stay noted yet for this session: this one is new.
  }
  if (!log(t, said)) return;
  try {
    mkdirSync(lockDir(), { recursive: true, mode: 0o700 });
    writeFileSync(stayFile(t.session), said, { mode: 0o600 });
  } catch {
    // Without the marker the same stay is logged again at the next stop: a repeat, never a flood of new reasons.
  }
}

export function forgetStay(session: string): void {
  try {
    rmSync(stayFile(session), { force: true });
  } catch {
    // A stay left behind only keeps that same reason from being logged once more.
  }
}

export function rotating(session: string, me = process.pid): boolean {
  return holders(session).some((pid) => pid !== me && alive(pid));
}

export function takeLock(session: string, me = process.pid): boolean {
  mkdirSync(lockDir(), { recursive: true, mode: 0o700 });
  writeFileSync(join(lockDir(), `${lockPrefix(session)}${me}`), "", { mode: 0o600 });
  for (const pid of holders(session)) if (pid !== me && !alive(pid)) rmSync(join(lockDir(), `${lockPrefix(session)}${pid}`), { force: true });
  if (!rotating(session, me)) return true;
  dropLock(session, me);
  return false;
}

export function dropLock(session: string, me = process.pid): void {
  rmSync(join(lockDir(), `${lockPrefix(session)}${me}`), { force: true });
}

function owns(t: Target, first: PaneId): boolean {
  const r = registry(t);
  if (r.kind === "gone" || r.session !== t.session) return false;
  const now = paneId(t);
  return now !== null && now.server === first.server && now.panePid === first.panePid && now.tty === first.tty && holdsInput(t.pid, now.tty) && showsThread(t) === "ready";
}

const RENDER_MS = 1_000;
const RENDER_EVERY_MS = 50;

async function until(t: Target, first: PaneId, quietMs: number, on: () => boolean, input: (captured: string) => boolean, ms = RENDER_MS): Promise<Check> {
  const end = Date.now() + ms;
  for (;;) {
    const seen = check(t, first, quietMs, on, input);
    if (seen !== "wait" || Date.now() >= end) return seen;
    await Bun.sleep(RENDER_EVERY_MS);
  }
}

async function send(t: Target, first: PaneId, quietMs: number, on: () => boolean, text: string, beforeEnter: () => void = () => {}): Promise<Check | "sent"> {
  if (tmux(t, ["send-keys", "-t", t.pane, "-l", text]) === null) return "send-failed";
  const seen = await until(t, first, quietMs, on, shows(t, text));
  if (seen === "ready") {
    beforeEnter();
    return tmux(t, ["send-keys", "-t", t.pane, "Enter"]) === null ? "send-failed" : "sent";
  }
  if (seen !== "wait" && seen !== "switched-off") return seen;
  const captured = tmux(t, ["capture-pane", "-p", "-e", "-t", t.pane]);
  if (captured === null || !endsWith(t, text)(captured) || !owns(t, first)) return "left-in-input";
  if (tmux(t, ["send-keys", "-t", t.pane, "-N", String(text.length), "BSpace"]) === null) return "send-failed";
  return seen;
}

const SETTLE_MS = 3_000;

async function firstPrompt(t: Target, first: PaneId, quietMs: number, on: () => boolean): Promise<Outcome> {
  if (t.harness !== "codex") return "cleared";
  const fresh: Target = { ...t, thread: { kind: "fresh" } };
  if ((await until(fresh, first, quietMs, on, empty(fresh), SETTLE_MS)) !== "ready") return "new-without-prompt";
  const sent = await send(fresh, first, quietMs, on, CODEX_FIRST);
  return sent === "sent" ? "cleared" : "new-without-prompt";
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
      const before = check(t, first, quietMs, on, empty(t));
      if (before !== "wait" && before !== "ready") return finish(t, before);
      if (before === "ready") {
        const sent = await send(t, first, quietMs, on, commandOf(t), () => {
          if (t.harness === "codex" && t.thread.kind === "old") offerHandoff(t.cwd, t.session, t.thread.by);
        });
        if (sent === "sent") return finish(t, await firstPrompt(t, first, quietMs, on));
        if (sent !== "wait") return finish(t, sent === "ready" ? "send-failed" : sent);
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
