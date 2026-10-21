import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { home } from "../config.ts";
import { appendRotated } from "../daemon/wake.ts";
import { codexTurn } from "../harness.ts";
import { offerHandoff } from "../hooks/handoff.ts";
import { alive } from "../hooks/listeners.ts";
import type { RexPlace } from "../terminals/plugin.ts";
import { rexBlockPresent, rexInstance, rexProcess, rexRootState } from "../terminals/rex/api.ts";
import { rexPane } from "../terminals/rex/type.ts";
import { holdsInput, leadsTerminal } from "../terminals/shared/foreground.ts";
import { tmuxNow } from "../terminals/shared/tmux.ts";
import { CODEX_FIRST, CODEX_NEW, codexInput, codexShown, sameWords } from "./codex.ts";

export interface ClaudeTarget {
  harness?: "claude";
  pid: number;
  session: string;
  claudeDir: string;
  pane?: string;
  socket?: string;
  rex?: RexPlace;
  bin?: string;
}

export type Thread = { kind: "old"; rollout: string; name: string; by: string } | { kind: "fresh" };

export interface CodexTarget {
  harness: "codex";
  pid: number;
  session: string;
  pane: string;
  socket: string;
  cwd: string;
  thread: Thread;
}

export type Target = ClaudeTarget | CodexTarget;

export type Outcome =
  | "cleared"
  | "new-without-prompt"
  | "not-its-thread"
  | "gone"
  | "moved"
  | "not-its-pane"
  | "busy-elsewhere"
  | "timed-out"
  | "no-tmux"
  | "no-pane"
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

type TmuxTarget = { pid: number; pane: string; socket: string };

function tmux(t: TmuxTarget, args: string[]): string | null {
  return tmuxNow(t.socket, args);
}

interface PaneId {
  server: string;
  panePid: string;
  tty: string;
}

function paneId(t: TmuxTarget): PaneId | null {
  const out = tmux(t, ["display-message", "-p", "-t", t.pane, "#{pid} #{pane_pid} #{pane_tty}"])?.trim().split(" ");
  return out && out.length === 3 ? { server: out[0]!, panePid: out[1]!, tty: out[2]! } : null;
}

type Check = Outcome | "wait" | "ready";

interface RexId {
  instance: string;
  block: string;
  child: number | null;
}

interface Backend {
  readonly kind: "tmux" | "rex";
  identify(): PaneId | RexId | null;
  same(first: PaneId | RexId): boolean;
  holds(first: PaneId | RexId): boolean;
  idle(first: PaneId | RexId): boolean;
  screen(first: PaneId | RexId): string | null;
  type(first: PaneId | RexId, text: string): boolean;
  enter(first: PaneId | RexId): boolean;
  erase(first: PaneId | RexId, count: number): boolean;
  calm(first: PaneId | RexId, now: number, quietMs: number): boolean;
  quiet(now: number, quietMs: number): boolean;
  forget(): void;
}

function tmuxBackend(t: TmuxTarget): Backend {
  const pane = t.pane;
  const cast = (id: PaneId | RexId): PaneId => id as PaneId;
  return {
    kind: "tmux",
    identify: () => paneId(t),
    same: (first) => {
      const now = paneId(t);
      const was = cast(first);
      return now !== null && now.server === was.server && now.panePid === was.panePid && now.tty === was.tty;
    },
    holds: (first) => holdsInput(t.pid, cast(first).tty),
    idle: () => true,
    screen: () => tmux(t, ["capture-pane", "-p", "-e", "-t", pane]),
    type: (_first, text) => tmux(t, ["send-keys", "-t", pane, "-l", text]) !== null,
    enter: () => tmux(t, ["send-keys", "-t", pane, "Enter"]) !== null,
    erase: (_first, count) => tmux(t, ["send-keys", "-t", pane, "-N", String(count), "BSpace"]) !== null,
    calm: (_first, now, quietMs) => {
      const clients = tmux(t, ["list-clients", "-t", pane, "-F", "#{client_activity}"]);
      if (clients === null) return false;
      const activity = clients
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => Number(line.trim()));
      return calm(activity, now, quietMs);
    },
    quiet: () => true,
    forget: () => {},
  };
}

function rexBackend(t: ClaudeTarget & { rex: RexPlace; bin: string }, quietMs: number): Backend {
  const place = t.rex;
  const bin = t.bin;
  let emptyAt: number | null = null;
  const cast = (id: PaneId | RexId): RexId => id as RexId;
  const pane = rexPane(place, bin);
  return {
    kind: "rex",
    identify: () => {
      if (rexBlockPresent(place, bin) === false) return null;
      const proc = rexProcess(place, bin);
      if (!proc) return null;
      return { instance: rexInstance(place, bin) ?? place.server, block: place.block, child: proc.child };
    },
    same: (first) => {
      const was = cast(first);
      if (rexBlockPresent(place, bin) === false) return false;
      const proc = rexProcess(place, bin);
      if (!proc) return false;
      const instance = rexInstance(place, bin) ?? place.server;
      return instance === was.instance && place.block === was.block && proc.child === was.child;
    },
    holds: () => {
      const proc = rexProcess(place, bin);
      return proc?.foreground === t.pid && leadsTerminal(t.pid) !== null;
    },
    idle: () => {
      const state = rexRootState(place, bin);
      return state === "done" || state === "idle";
    },
    screen: () => pane.screen(),
    type: (_first, text) => pane.type(text),
    enter: () => pane.enter(),
    erase: (_first, count) => pane.erase(count),
    calm: () => true,
    quiet: (now) => {
      if (emptyAt === null) {
        emptyAt = now;
        return false;
      }
      return now - emptyAt >= quietMs;
    },
    forget: () => {
      emptyAt = null;
    },
  };
}

function backendFor(t: Target, quietMs: number): Backend | null {
  if (t.harness === "codex") return tmuxBackend(t);
  if (t.rex && t.bin) return rexBackend({ ...t, rex: t.rex, bin: t.bin }, quietMs);
  if (t.pane && t.socket) return tmuxBackend({ ...t, pane: t.pane, socket: t.socket });
  return null;
}

function showsThread(t: Target): Check {
  if (t.harness !== "codex") return "ready";
  const title = tmux(t, ["display-message", "-p", "-t", t.pane, "#{pane_title}"]);
  if (title === null) return "no-tmux";
  const shown = codexShown(title.replace(/\n$/, ""));
  if (shown.kind === "busy") return "wait";
  if (t.thread.kind === "fresh") return shown.kind === "unnamed" ? "ready" : "wait";
  return shown.kind === "named" && shown.name === t.thread.name ? "ready" : "not-its-thread";
}

function check(t: Target, backend: Backend, first: PaneId | RexId, quietMs: number, on: () => boolean, input: (captured: string) => boolean, proofMs = 0): Check {
  if (!on()) return "switched-off";
  const r = registry(t);
  if (r.kind === "gone") return "gone";
  if (r.session !== null && r.session !== t.session) return "moved";
  const now = backend.identify();
  if (now === null) return backend.kind === "rex" ? "no-pane" : "no-tmux";
  if (!backend.same(first)) return "not-its-pane";
  if (!backend.holds(now)) {
    backend.forget();
    return "wait";
  }
  if (r.session === null || !r.idle || !backend.idle(now)) {
    backend.forget();
    return "wait";
  }
  const thread = showsThread(t);
  if (thread !== "ready") {
    backend.forget();
    return thread;
  }
  if (!backend.calm(now, Date.now(), quietMs)) {
    backend.forget();
    return t.harness === "codex" && tmux(t, ["list-clients", "-t", t.pane, "-F", "#{client_activity}"]) === null ? "no-tmux" : "wait";
  }
  const captured = backend.screen(now);
  if (captured === null) return backend.kind === "rex" ? "no-pane" : "no-tmux";
  if (!input(captured)) {
    backend.forget();
    return "wait";
  }
  if (proofMs > 0 && !backend.quiet(Date.now(), proofMs)) return "wait";
  return "ready";
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

export type Teller = { pid: number; session: string; pane?: string; rex?: RexPlace };

function log(t: Teller, what: string): boolean {
  try {
    appendRotated(join(home(), "rotate.log"), `${new Date().toISOString()} pid ${t.pid} session ${t.session} ${t.rex ? `rex ${t.rex.block}` : `pane ${t.pane}`}: ${what}\n`);
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

function owns(t: Target, backend: Backend, first: PaneId | RexId): boolean {
  const r = registry(t);
  if (r.kind === "gone" || r.session !== t.session) return false;
  if (!backend.same(first)) return false;
  const now = backend.identify();
  return now !== null && backend.holds(now) && showsThread(t) === "ready";
}

const RENDER_MS = 1_000;
const RENDER_EVERY_MS = 50;

async function until(t: Target, backend: Backend, first: PaneId | RexId, quietMs: number, on: () => boolean, input: (captured: string) => boolean, ms = RENDER_MS): Promise<Check> {
  const end = Date.now() + ms;
  for (;;) {
    const seen = check(t, backend, first, quietMs, on, input);
    if (seen !== "wait" || Date.now() >= end) return seen;
    await Bun.sleep(RENDER_EVERY_MS);
  }
}

async function send(t: Target, backend: Backend, first: PaneId | RexId, quietMs: number, on: () => boolean, text: string, beforeEnter: () => void = () => {}): Promise<Check | "sent"> {
  if (!backend.type(first, text)) return "send-failed";
  const seen = await until(t, backend, first, quietMs, on, shows(t, text));
  if (seen === "ready") {
    beforeEnter();
    return backend.enter(first) ? "sent" : "send-failed";
  }
  if (seen !== "wait" && seen !== "switched-off") return seen;
  const captured = backend.screen(first);
  if (captured === null || !endsWith(t, text)(captured) || !owns(t, backend, first)) return "left-in-input";
  if (!backend.erase(first, text.length)) return "send-failed";
  return seen;
}

const SETTLE_MS = 3_000;

async function firstPrompt(t: Target, backend: Backend, first: PaneId | RexId, quietMs: number, on: () => boolean): Promise<Outcome> {
  if (t.harness !== "codex") return "cleared";
  const fresh: CodexTarget = { ...t, thread: { kind: "fresh" } };
  if ((await until(fresh, backend, first, quietMs, on, empty(fresh), SETTLE_MS)) !== "ready") return "new-without-prompt";
  const sent = await send(fresh, backend, first, quietMs, on, CODEX_FIRST);
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
  const backend = backendFor(t, quietMs);
  if (!backend) return finish(t, "no-pane");
  const first = backend.identify();
  if (first === null) return finish(t, backend.kind === "rex" ? "no-pane" : "no-tmux");
  if (!backend.holds(first)) return finish(t, "not-its-pane");
  if (!takeLock(t.session)) return finish(t, "busy-elsewhere");
  try {
    const proofMs = backend.kind === "rex" ? quietMs : 0;
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const before = check(t, backend, first, quietMs, on, empty(t), proofMs);
      if (before !== "wait" && before !== "ready") return finish(t, before);
      if (before === "ready") {
        const sent = await send(t, backend, first, quietMs, on, commandOf(t), () => {
          if (t.harness === "codex" && t.thread.kind === "old") offerHandoff(t.cwd, t.session, t.thread.by);
        });
        if (sent === "sent") return finish(t, await firstPrompt(t, backend, first, quietMs, on));
        if (sent !== "wait") return finish(t, sent === "ready" ? "send-failed" : sent);
      }
      await Bun.sleep(everyMs);
    }
    return finish(t, "timed-out");
  } finally {
    dropLock(t.session);
  }
}

function finish(t: Teller, outcome: Outcome): Outcome {
  log(t, outcome);
  return outcome;
}
