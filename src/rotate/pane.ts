import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { home } from "../config.ts";
import { appendRotated } from "../daemon/wake.ts";
import { alive } from "../hooks/listeners.ts";
import { rexBlockPresent, rexInstance, rexProcess, rexRootState, rexScreen, runRex, type RexPlace } from "../rex.ts";
import { leadsTerminal } from "../status.ts";

export interface Target {
  pid: number;
  session: string;
  claudeDir: string;
  pane?: string;
  socket?: string;
  rex?: RexPlace;
  bin?: string;
}

export type Outcome = "cleared" | "gone" | "moved" | "not-its-pane" | "busy-elsewhere" | "timed-out" | "no-tmux" | "no-pane" | "send-failed" | "left-in-input" | "switched-off";

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

type TmuxTarget = Target & { pane: string; socket: string };

function tmux(t: TmuxTarget, args: string[]): string | null {
  const r = spawnSync("tmux", ["-S", t.socket, ...args], { encoding: "utf8", timeout: 5_000 });
  return r.status === 0 ? r.stdout : null;
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

function holdsInput(pid: number, tty: string): boolean {
  const r = spawnSync("ps", ["-o", "tty=,tpgid=,pgid=", "-p", String(pid)], { encoding: "utf8", timeout: 2_000 });
  const [own, fg, group] = r.status === 0 ? r.stdout.trim().split(/\s+/) : [];
  return !!own && own !== "?" && tty.endsWith(`/${own.replace(/^\/dev\//, "")}`) && fg === String(pid) && group === String(pid);
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

function rexBackend(t: Target & { rex: RexPlace; bin: string }, quietMs: number): Backend {
  const place = t.rex;
  const bin = t.bin;
  let emptyAt: number | null = null;
  const cast = (id: PaneId | RexId): RexId => id as RexId;
  const sendKey = (keyName: string): boolean => runRex(bin, ["-S", place.server, "send-key", "-s", place.session, "-b", place.block, keyName]).status === 0;
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
    screen: () => rexScreen(place, bin),
    type: (_first, text) => runRex(bin, ["-S", place.server, "send", "-s", place.session, "-b", place.block, text]).status === 0,
    enter: () => sendKey("enter"),
    erase: (_first, count) => {
      for (let i = 0; i < count; i += 1) if (!sendKey("backspace")) return false;
      return true;
    },
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
  if (t.rex && t.bin) return rexBackend({ ...t, rex: t.rex, bin: t.bin }, quietMs);
  if (t.pane && t.socket) return tmuxBackend({ ...t, pane: t.pane, socket: t.socket });
  return null;
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
  if (!backend.calm(now, Date.now(), quietMs)) {
    backend.forget();
    return "wait";
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

const empty = (captured: string) => inputText(captured) === "";
const typedClear = (captured: string) => inputText(captured, null) === CLEAR;
const endsWithClear = (captured: string) => inputText(captured, null)?.endsWith(CLEAR) === true;

function log(t: Target, what: string): void {
  try {
    appendRotated(join(home(), "rotate.log"), `${new Date().toISOString()} pid ${t.pid} session ${t.session} pane ${t.pane ?? t.rex?.block}: ${what}\n`);
  } catch {
    // The log only explains what happened; failing to write it changes nothing.
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
  return now !== null && backend.holds(now);
}

const RENDER_MS = 1_000;
const RENDER_EVERY_MS = 50;

async function shown(t: Target, backend: Backend, first: PaneId | RexId, quietMs: number, on: () => boolean): Promise<Check> {
  const end = Date.now() + RENDER_MS;
  for (;;) {
    const typed = check(t, backend, first, quietMs, on, typedClear);
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
      const before = check(t, backend, first, quietMs, on, empty, proofMs);
      if (before !== "wait" && before !== "ready") return finish(t, before);
      if (before === "ready") {
        if (!backend.type(first, CLEAR)) return finish(t, "send-failed");
        const typed = await shown(t, backend, first, quietMs, on);
        if (typed === "ready") return finish(t, backend.enter(first) ? "cleared" : "send-failed");
        if (typed !== "wait" && typed !== "switched-off") return finish(t, typed);
        const captured = backend.screen(first);
        if (captured === null || !endsWithClear(captured) || !owns(t, backend, first)) return finish(t, "left-in-input");
        if (!backend.erase(first, CLEAR.length)) return finish(t, "send-failed");
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
