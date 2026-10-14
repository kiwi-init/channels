// Harness hooks: make "how to join" the only instruction an agent needs.
//
// `kiwi join` / `kiwi create` bind the agent's working directory to its channel
// and install user-level hooks for the harness this process is inside: Claude
// Code when CLAUDECODE is set, and Codex, Gemini, Cursor, or Grok when that
// harness's own session env is set. `kiwi hooks install` writes every detected
// harness. User-level files only, so nothing asks for a project trust prompt.
// They do nothing in any session whose directory isn't bound, so they're safe
// to keep installed globally:
//
//   SessionStart      tell the agent who it is on which channel, and to start listening
//   UserPromptSubmit  hand the agent any unread messages along with the human's prompt
//   Stop              don't let the agent go idle with unread messages, or deaf
//                     (no live `kiwi tail` / `kiwi wait` listener for it)
//
// Claude Code also gets a listener: `kiwi hook listen` on each of those events, run in
// the background with asyncRewake. It waits for a message for the agent and wakes the
// session with it, idle or not, so nobody has to start a Monitor.
//
// Hooks must never break a session: every failure path exits 0 silently. Running
// one is an Effect (runHook) the CLI runs like any command; installing them is
// plain file work.

import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { openSession, type AgentSession } from "./agent.ts";
import { noteTranscript } from "./card.ts";
import { Cursor, home, Keystore, loadConfig, type ChannelConfig } from "./config.ts";
import { ChannelGone } from "./client.ts";
import { briefText, COMMANDS } from "./brief.ts";
import { charterLines, formatMessage, holdLine, modeLine } from "./format.ts";
import { humanOf } from "./state.ts";
import { bindDirectory as bindSeat, bindingFor as seatFor, here, seatsNear, type Binding, type Here, type Listener, type SeatOptions } from "./seats.ts";

/** Marks our entries so install/uninstall can find them. Current clients only. */
const MARK = "# kiwi";
const EVENTS = { SessionStart: "session-start", UserPromptSubmit: "prompt", Stop: "stop" } as const;
/** The background listener (Claude Code only): armed on every one of EVENTS, it exits at once when one already runs. */
const LISTEN = "listen";
/** How long one listener lives; Claude Code enforces an asyncRewake hook's timeout, so it ends itself just before. */
const LISTEN_SECONDS = 24 * 3600;

// ---------- directory bindings ----------
// Seats (seats.ts) say which agent works in a directory; a live listener is how a seat without a
// recorded process shows it's still held.

export type { Binding } from "./seats.ts";

/** The seat this process (or hook, for `who`) acts for in `dir`. */
export function bindingFor(dir: string, opts: Omit<SeatOptions, "listeners"> = {}): Binding | null {
  return seatFor(dir, { ...opts, listeners: liveListeners });
}

/** Give an agent its seat in `dir`, never pushing out another agent that's listening from here. */
export function bindDirectory(dir: string, b: Binding): boolean {
  return bindSeat(dir, b, isListening);
}

// ---------- live listeners ----------

function listenerDir(): string {
  return join(home(), "listeners");
}

/**
 * Record that this process listens for `as` on `alias`, and for which session (when its harness says),
 * so that session's hooks know who it is; removed on exit.
 */
export function registerListener(alias: string, as: string): void {
  const dir = listenerDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${encodeURIComponent(alias)}.${encodeURIComponent(as)}.${process.pid}`);
  const who = here();
  writeFileSync(file, JSON.stringify({ at: Date.now(), alias, as, cwd: process.cwd(), ...who }));
  const drop = () => rmSync(file, { force: true });
  process.on("exit", drop);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      drop();
      process.exit(0);
    });
  }
}

/** The live listener records (stale ones are cleaned up): each file's name, and what it says. */
function liveRecords(): { name: string; rec: Record<string, unknown> }[] {
  const dir = listenerDir();
  if (!existsSync(dir)) return [];
  const out: { name: string; rec: Record<string, unknown> }[] = [];
  for (const f of readdirSync(dir)) {
    const pid = Number(f.slice(f.lastIndexOf(".") + 1));
    try {
      process.kill(pid, 0);
    } catch {
      rmSync(join(dir, f), { force: true });
      continue;
    }
    let rec: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown;
      if (parsed && typeof parsed === "object") rec = parsed as Record<string, unknown>;
    } catch {
      // A record from before 0.10.3: a timestamp, nothing about who started it.
    }
    out.push({ name: f, rec });
  }
  return out;
}

/** Every live listener on this machine. One from before 0.10.3 says only who it listens as (when its file name can tell). */
export function liveListeners(): Listener[] {
  const out: Listener[] = [];
  for (const { name, rec } of liveRecords()) {
    const parts = name.split(".");
    const alias = typeof rec.alias === "string" ? rec.alias : parts.length === 3 ? decodeURIComponent(parts[0]!) : null;
    const as = typeof rec.as === "string" ? rec.as : parts.length === 3 ? decodeURIComponent(parts[1]!) : null;
    if (alias === null || as === null) continue;
    out.push({
      alias,
      as,
      ...(typeof rec.cwd === "string" ? { cwd: rec.cwd } : {}),
      ...(typeof rec.harness === "string" ? { harness: rec.harness as Listener["harness"] } : {}),
      ...(typeof rec.session === "string" ? { session: rec.session } : {}),
      ...(Number.isInteger(rec.pid) ? { pid: rec.pid as number } : {}),
    });
  }
  return out;
}

/** Whether some live process is listening for `as` on `alias`. */
export function isListening(alias: string, as: string): boolean {
  const prefix = `${encodeURIComponent(alias)}.${encodeURIComponent(as)}.`;
  return liveRecords().some(({ name }) => name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)));
}

function deliveredFile(alias: string, as: string, session: string): string {
  return join(home(), "listen-hooks", `${encodeURIComponent(alias)}.${encodeURIComponent(as)}.${encodeURIComponent(session)}.delivered`);
}

/** How far the background listener handed messages to this session, still to be committed (0: nothing). */
function deliveredUpTo(alias: string, as: string, session: string): number {
  try {
    return Number(readFileSync(deliveredFile(alias, as, session), "utf8")) || 0;
  } catch {
    return 0;
  }
}

function noteDelivered(alias: string, as: string, session: string, seq: number): void {
  mkdirSync(join(home(), "listen-hooks"), { recursive: true, mode: 0o700 });
  writeFileSync(deliveredFile(alias, as, session), String(Math.max(seq, deliveredUpTo(alias, as, session))));
}

/** The session took its turn after the listener woke it: what it was handed is read now. */
const commitDelivered = Effect.fn("Hooks.commitDelivered")(function* (s: AgentSession, session: string) {
  const upTo = deliveredUpTo(s.alias, s.me, session);
  if (!upTo) return;
  const cursor = yield* Cursor;
  if (((yield* cursor.read(s.alias, s.me)) ?? 0) < upTo) yield* cursor.write(s.alias, s.me, upTo);
  rmSync(deliveredFile(s.alias, s.me, session), { force: true });
  yield* s.markRead(upTo);
});

/** Hold the one background listener slot for `as` on `alias` in this session; false when a live one already has it. */
function takeListenSlot(alias: string, as: string, session: string): boolean {
  const dir = join(home(), "listen-hooks");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${encodeURIComponent(alias)}.${encodeURIComponent(as)}.${encodeURIComponent(session)}`);
  for (let tries = 0; tries < 2; tries++) {
    try {
      writeFileSync(file, String(process.pid), { flag: "wx" });
      process.on("exit", () => {
        try {
          if (readFileSync(file, "utf8") === String(process.pid)) rmSync(file, { force: true });
        } catch {}
      });
      return true;
    } catch {
      const pid = Number(existsSync(file) ? readFileSync(file, "utf8") : 0);
      try {
        if (pid > 0) {
          process.kill(pid, 0);
          return false;
        }
      } catch {}
      rmSync(file, { force: true });
    }
  }
  return false;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

// ---------- installing into Claude Code ----------

function settingsPath(): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json");
}

/** How to invoke this very `kiwi`, wherever and however it's installed. */
function selfCommand(): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const compiled = !/\.(ts|js)$/.test(Bun.main);
  // Prefer the PATH entry for bun (e.g. /opt/homebrew/bin/bun) over its versioned real path, which upgrades remove.
  const bun = Bun.which("bun") ?? process.execPath;
  return compiled ? q(process.execPath) : `${q(bun)} ${q(Bun.main)}`;
}

type HookEntry = { matcher?: string; hooks: { type: "command"; command: string; timeout?: number; async?: boolean; asyncRewake?: boolean }[] };
type Settings = { hooks?: Record<string, HookEntry[]> } & Record<string, unknown>;

function readSettings(): Settings {
  const p = settingsPath();
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Settings) : {};
}

function writeSettings(s: Settings): void {
  const p = settingsPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
}

/**
 * A command this program wrote: `<invocation> hook <event> # kiwi`.
 * Matching the mark alone would delete someone else's hook that merely
 * mentions "# kiwi". Any invocation is recognised, so a reinstall replaces
 * the entry instead of adding a second one.
 */
function isOurHookCommand(command: string): boolean {
  for (const event of [...Object.values(EVENTS), LISTEN]) {
    const tail = ` hook ${event} ${MARK}`;
    if (command.endsWith(tail) && command.length > tail.length) return true;
  }
  return false;
}

function withoutOurs(entries: HookEntry[] | undefined): HookEntry[] {
  return (entries ?? [])
    .map((e) => ({ ...e, hooks: e.hooks.filter((h) => !isOurHookCommand(h.command)) }))
    .filter((e) => e.hooks.length > 0);
}

/** The command string every harness runs. Grok's Stop entry must stay identical to Claude's, so Grok's Claude-compat load dedupes them. */
function hookCommand(arg: string): string {
  return `${selfCommand()} hook ${arg} ${MARK}`;
}

/** Install (or refresh) our hooks in the user's Claude Code settings. Returns the settings path. */
export function installHooks(): string {
  const s = readSettings();
  s.hooks ??= {};
  // The listener only for a Claude Code that can run it (asyncRewake), checked where its version is known
  // (kiwi join from inside it). Elsewhere (kiwi setup, hooks install in a terminal) keep whatever's there.
  const listen = claudeVersion() ? rewakeCapable() : Object.keys(EVENTS).every((event) => hasHook(s, event, LISTEN));
  for (const [event, arg] of Object.entries(EVENTS)) {
    s.hooks[event] = [
      ...withoutOurs(s.hooks[event]),
      { hooks: [{ type: "command", command: hookCommand(arg), timeout: event === "UserPromptSubmit" ? 20 : 30 }] },
      // `async` too, so nothing ever waits on it.
      ...(listen ? [{ hooks: [{ type: "command" as const, command: hookCommand(LISTEN), async: true, asyncRewake: true, timeout: LISTEN_SECONDS + 60 }] }] : []),
    ];
  }
  writeSettings(s);
  return settingsPath();
}

export function uninstallHooks(): string {
  const s = readSettings();
  for (const event of Object.keys(s.hooks ?? {})) {
    const kept = withoutOurs(s.hooks![event]);
    if (kept.length) s.hooks![event] = kept;
    else delete s.hooks![event];
  }
  if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks;
  writeSettings(s);
  return settingsPath();
}

function hasHook(s: Settings, event: string, arg: string): boolean {
  return !!s.hooks?.[event]?.some((x) => x.hooks.some((h) => h.command === hookCommand(arg) && (arg !== LISTEN || h.asyncRewake === true)));
}

/** Ours are all there, and so is the listener when this Claude Code can run it. */
export function hooksInstalled(): boolean {
  const s = readSettings();
  const listen = claudeVersion() ? rewakeCapable() : false;
  return Object.entries(EVENTS).every(([event, arg]) => hasHook(s, event, arg) && (!listen || hasHook(s, event, LISTEN)));
}

/** The first Claude Code with asyncRewake hooks that we checked: older ones get the Monitor instructions instead. */
const REWAKE_SINCE = [2, 1, 296] as const;

/** The Claude Code version running this process, from what it sets on its hooks and shell commands. */
export function claudeVersion(env: Record<string, string | undefined> = process.env): number[] | null {
  // AI_AGENT ("claude-code_2-1-296_agent") on its shell commands; else the version folder its binary sits in (…/2.1.296/claude).
  const m = /^claude-code_(\d+)-(\d+)-(\d+)_/.exec(env.AI_AGENT ?? "") ?? /[\\/](\d+)\.(\d+)\.(\d+)[\\/]claude(?:\.exe)?$/.exec(env.CLAUDE_CODE_EXECPATH ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Whether this is a Claude Code that runs asyncRewake hooks. Only its shell commands say its version
 * (not its hooks), so this is asked where the hooks are installed: `kiwi join` from inside it.
 */
export function rewakeCapable(env: Record<string, string | undefined> = process.env): boolean {
  if (!env.CLAUDECODE || env.GROK_SESSION_ID) return false;
  const v = claudeVersion(env);
  return !!v && (v[0]! - REWAKE_SINCE[0] || v[1]! - REWAKE_SINCE[1] || v[2]! - REWAKE_SINCE[2]) >= 0;
}

/**
 * Whether Kiwi's hooks listen for this Claude Code session: the listener is installed (only ever by a
 * Claude Code that runs it). Then nobody starts a Monitor, and nothing nags about one.
 */
export function hooksListen(env: Record<string, string | undefined> = process.env): boolean {
  if (!env.CLAUDECODE || env.GROK_SESSION_ID) return false;
  // When this Claude Code does say its version and it's too old for asyncRewake, the settings' listener isn't for it.
  if (claudeVersion(env) && !rewakeCapable(env)) return false;
  try {
    const s = readSettings();
    return Object.keys(EVENTS).every((event) => hasHook(s, event, LISTEN));
  } catch {
    return false;
  }
}

/** Install automatically when an agent joins from inside Claude Code (opt out with KIWI_NO_HOOKS=1). */
export function autoInstallHooks(): string | null {
  // Never against the choice this computer's person made in `kiwi setup`.
  if (process.env.KIWI_NO_HOOKS || !process.env.CLAUDECODE || loadConfig().claudeHooks === "off") return null;
  try {
    // A different invocation path still counts as installed only when the command string matches this binary.
    return hooksInstalled() ? null : installHooks();
  } catch {
    return null;
  }
}

// ---------- Codex, Gemini, Cursor, Grok (user-level only) ----------

export const EXTRA_HARNESSES = ["codex", "gemini", "cursor", "grok"] as const;
export type ExtraHarness = (typeof EXTRA_HARNESSES)[number];

/** Set in tests so install never writes the real home. Unset means the harness's own user dir. */
const HARNESS_ENV: Record<ExtraHarness, string> = {
  codex: "KIWI_CODEX_DIR",
  gemini: "KIWI_GEMINI_DIR",
  cursor: "KIWI_CURSOR_DIR",
  grok: "KIWI_GROK_DIR",
};

/**
 * Set on the shell commands the harness runs, the same idea as CLAUDECODE.
 * A present install directory is not enough: join must not write a harness
 * the agent is not inside. Checked 2026-10-10:
 *   Codex  CODEX_THREAD_ID   injected into shell commands when a thread id is
 *          present, including when include_only is set (openai/codex
 *          codex-rs/core/src/exec_env.rs and
 *          codex-rs/protocol/src/shell_environment.rs, CODEX_THREAD_ID_ENV_VAR).
 *   Gemini GEMINI_CLI=1     set by run_shell_command
 *          (https://geminicli.com/docs/tools/shell).
 *   Cursor CURSOR_AGENT     set while the agent runs; shell config is told to
 *          detect the session with it (https://cursor.com/docs/agent/terminal).
 *   Grok   GROK_SESSION_ID  this session's id, injected on every hook
 *          (user guide 10-hooks.md) and present on this agent's shell commands.
 *          GROK_AGENT is an agent-definition name (user guide 05-configuration.md),
 *          so it is not a session marker.
 */
const SESSION_ENV: Record<ExtraHarness, string> = {
  codex: "CODEX_THREAD_ID",
  gemini: "GEMINI_CLI",
  cursor: "CURSOR_AGENT",
  grok: "GROK_SESSION_ID",
};

function harnessRoot(h: ExtraHarness): string {
  const over = process.env[HARNESS_ENV[h]];
  if (over) return over;
  if (h === "codex") return join(homedir(), ".codex");
  if (h === "gemini") return join(homedir(), ".gemini");
  if (h === "cursor") return join(homedir(), ".cursor");
  return join(homedir(), ".grok");
}

function harnessPath(h: ExtraHarness): string {
  if (h === "codex") return join(harnessRoot(h), "hooks.json");
  if (h === "gemini") return join(harnessRoot(h), "settings.json");
  if (h === "cursor") return join(harnessRoot(h), "hooks.json");
  return join(harnessRoot(h), "hooks", "kiwi.json");
}

/**
 * A harness counts as installed when its user dir exists, or its binary is on PATH.
 * An explicit KIWI_*_DIR counts only when that directory exists, so tests can point
 * these away from the real home without creating files there.
 */
export function harnessPresent(h: ExtraHarness): boolean {
  if (process.env[HARNESS_ENV[h]] !== undefined) return existsSync(harnessRoot(h));
  if (existsSync(harnessRoot(h))) return true;
  const bins = h === "codex" ? ["codex"] : h === "gemini" ? ["gemini"] : h === "cursor" ? ["cursor"] : ["grok"];
  return bins.some((b) => !!Bun.which(b));
}

function readJson(p: string): Record<string, any> {
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, any>;
}

function writeJson(p: string, value: unknown): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
}

const GEMINI_EVENTS = { SessionStart: "session-start", BeforeAgent: "prompt", AfterAgent: "stop" } as const;

function installClaudeShaped(path: string, events: Record<string, string>, timeoutFor: (event: string) => number, matcher?: string): void {
  const s = readJson(path) as Settings;
  s.hooks ??= {};
  for (const [event, arg] of Object.entries(events)) {
    s.hooks[event] = [
      ...withoutOurs(s.hooks[event]),
      { ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: hookCommand(arg), timeout: timeoutFor(event) }] },
    ];
  }
  writeJson(path, s);
}

function stripClaudeShaped(path: string): void {
  if (!existsSync(path)) return;
  const s = readJson(path) as Settings;
  for (const event of Object.keys(s.hooks ?? {})) {
    const kept = withoutOurs(s.hooks![event]);
    if (kept.length) s.hooks![event] = kept;
    else delete s.hooks![event];
  }
  if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks;
  if (!Object.keys(s).length) {
    rmSync(path, { force: true });
    return;
  }
  writeJson(path, s);
}

function claudeShapedInstalled(path: string, events: Record<string, string>): boolean {
  if (!existsSync(path)) return false;
  const s = readJson(path) as Settings;
  return Object.entries(events).every(([event, arg]) => s.hooks?.[event]?.some((x) => x.hooks.some((h) => h.command === hookCommand(arg))));
}

type CursorHook = { command?: string; timeout?: number; loop_limit?: number | null };
type CursorFile = { version?: number; hooks?: Record<string, CursorHook[]> } & Record<string, unknown>;

function cursorHooks(list: unknown): CursorHook[] {
  if (!Array.isArray(list)) return [];
  return list.filter((h) => !h || typeof h.command !== "string" || !isOurHookCommand(h.command));
}

function installCursorFile(path: string): void {
  const s = readJson(path) as CursorFile;
  if (s.version == null) s.version = 1;
  s.hooks ??= {};
  s.hooks.sessionStart = [...cursorHooks(s.hooks.sessionStart), { command: hookCommand("session-start"), timeout: 20 }];
  s.hooks.stop = [...cursorHooks(s.hooks.stop), { command: hookCommand("stop"), timeout: 30, loop_limit: 5 }];
  writeJson(path, s);
}

function stripCursorFile(path: string): void {
  if (!existsSync(path)) return;
  const s = readJson(path) as CursorFile;
  if (s.hooks) {
    for (const event of Object.keys(s.hooks)) {
      const kept = cursorHooks(s.hooks[event]);
      if (kept.length) s.hooks[event] = kept;
      else delete s.hooks[event];
    }
    if (!Object.keys(s.hooks).length) delete s.hooks;
  }
  writeJson(path, s);
}

function cursorFileInstalled(path: string): boolean {
  if (!existsSync(path)) return false;
  const s = readJson(path) as CursorFile;
  const has = (event: string, arg: string) => (s.hooks?.[event] ?? []).some((h) => h.command === hookCommand(arg));
  return has("sessionStart", "session-start") && has("stop", "stop");
}

/** Install one harness's user-level file. Creates the file even when the harness isn't detected. */
export function installExtra(h: ExtraHarness): string {
  const path = harnessPath(h);
  if (h === "codex") installClaudeShaped(path, EVENTS, (event) => (event === "UserPromptSubmit" ? 20 : 30));
  else if (h === "gemini") installClaudeShaped(path, GEMINI_EVENTS, (event) => (event === "BeforeAgent" ? 20_000 : 30_000), "*");
  else if (h === "cursor") installCursorFile(path);
  else installClaudeShaped(path, { Stop: "stop" }, () => 30);
  return path;
}

export function uninstallExtra(h: ExtraHarness): string {
  const path = harnessPath(h);
  if (h === "cursor") stripCursorFile(path);
  else stripClaudeShaped(path);
  return path;
}

export function extraInstalled(h: ExtraHarness): boolean {
  if (h === "cursor") return cursorFileInstalled(harnessPath(h));
  if (h === "gemini") return claudeShapedInstalled(harnessPath(h), GEMINI_EVENTS);
  if (h === "grok") return claudeShapedInstalled(harnessPath(h), { Stop: "stop" });
  return claudeShapedInstalled(harnessPath(h), EVENTS);
}

const HARNESS_LABEL: Record<ExtraHarness, string> = { codex: "Codex", gemini: "Gemini", cursor: "Cursor", grok: "Grok" };

/**
 * Install the harness this process is running inside. Does not change
 * harnessHooks: "off" and KIWI_NO_HOOKS skip, and a file that already has our
 * command is left as it is. Returns null when nothing was written.
 */
export function autoInstallExtraHooks(): string | null {
  if (process.env.KIWI_NO_HOOKS) return null;
  const choice = loadConfig().harnessHooks ?? {};
  const wrote: string[] = [];
  for (const h of EXTRA_HARNESSES) {
    if (!process.env[SESSION_ENV[h]] || choice[h] === "off") continue;
    try {
      if (extraInstalled(h)) continue;
      wrote.push(`${HARNESS_LABEL[h]} hooks (${installExtra(h)})`);
    } catch {
      // A corrupt file must not fail join.
    }
  }
  return wrote.length ? wrote.join(", ") : null;
}

/** Claude, plus every detected harness that this computer has not opted out of. */
export function installDetected(): string[] {
  const paths = [installHooks()];
  const choice = loadConfig().harnessHooks ?? {};
  for (const h of EXTRA_HARNESSES) {
    if (choice[h] === "off" || !harnessPresent(h)) continue;
    paths.push(installExtra(h));
  }
  return paths;
}

export function uninstallDetected(): string[] {
  const paths = [uninstallHooks()];
  for (const h of EXTRA_HARNESSES) paths.push(uninstallExtra(h));
  return paths;
}

/** One status line per harness. */
export function hooksStatus(): string {
  const choice = loadConfig().harnessHooks ?? {};
  const claude = loadConfig().claudeHooks === "off" && !hooksInstalled() ? "off" : hooksInstalled() ? "installed" : "not installed";
  const lines = [`claude: ${claude}`];
  for (const h of EXTRA_HARNESSES) {
    if (extraInstalled(h)) lines.push(`${h}: installed`);
    else if (choice[h] === "off") lines.push(`${h}: off`);
    else if (!harnessPresent(h)) lines.push(`${h}: not detected`);
    else lines.push(`${h}: not installed`);
  }
  return lines.join("\n");
}

/**
 * How a Stop hook should answer. Grok sends hook_event_name "Stop" (and also
 * hookEventName "stop"), so it stays on the Claude block path and cannot be
 * mistaken for Cursor, whose stop input has status and loop_count and no event name.
 */
export function stopStyle(input: { hook_event_name?: string; status?: string; loop_count?: number }): "cursor" | "gemini" | "block" {
  if (input.hook_event_name === "AfterAgent") return "gemini";
  if (input.hook_event_name === "Stop") return "block";
  if (input.status != null || typeof input.loop_count === "number") return "cursor";
  return "block";
}

/** Cursor's stop follow-up. Same text every time, and short: loop_limit is 5. */
export function cursorStopFollowup(mc: string, unread: boolean, listening: boolean, loopCount: number): string | null {
  if (unread) return `Unread Kiwi messages. Run \`${mc} read\`, answer with \`${mc} reply N "…"\`, then continue.`;
  if (!listening && loopCount === 0) return `Nothing is listening on Kiwi. Start a Monitor on \`${mc} tail\`.`;
  return null;
}

// ---------- running a hook ----------

interface HookInput {
  session_id?: string;
  /** Claude Code: the session's transcript, where the model it answers with is written. */
  transcript_path?: string;
  cwd?: string;
  stop_hook_active?: boolean;
  hook_event_name?: string;
  hookEventName?: string;
  status?: string;
  loop_count?: number;
  composer_mode?: string;
  is_background_agent?: boolean;
}

/** Remember when we last nagged a session about not listening (per kind of nag), so it's at most every 10 minutes. */
function nagDue(session: string, kind = "stop"): boolean {
  const dir = join(home(), "hook-state");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, encodeURIComponent(session || "unknown") + (kind === "stop" ? "" : `.${kind}`));
  const last = existsSync(file) ? Number(readFileSync(file, "utf8")) : 0;
  if (Date.now() - last < 10 * 60_000) return false;
  writeFileSync(file, String(Date.now()));
  return true;
}

/** How an agent's shell should call kiwi: plain `kiwi` when it's on PATH, else the full path. */
export function mcBin(): string {
  if (Bun.which("kiwi")) return "kiwi";
  const installed = join(homedir(), ".kiwi", "bin", process.platform === "win32" ? "kiwi.exe" : "kiwi");
  if (existsSync(installed)) return installed;
  return selfCommand();
}

/**
 * The command this agent types. Plain `kiwi` when its seat in `dir` already says who it is for this
 * session; otherwise naming its channel and itself, so nothing else on the machine can redirect it.
 */
export function mcFor(alias: string, as: string, dir = process.cwd(), who?: Here): string {
  const b = bindingFor(dir, { ...(who ? { who } : {}), claim: false });
  const mine = b?.alias === alias && b.as === as && (b.session ? b.session === (who ?? here()).session : seatsNear(dir).length === 1);
  return mine ? mcBin() : `${mcBin()} -c ${alias} --as ${as}`;
}

const MAX_CONTEXT = 6_000;

const unreadText = Effect.fn("Hooks.unreadText")(function* (s: AgentSession) {
  const { messages, state } = yield* s.read();
  const text = messages.map((m) => formatMessage(m, state.trust.get(m.seq), state, s.me)).join("\n");
  return text.length > MAX_CONTEXT ? `${text.slice(0, MAX_CONTEXT)}\n… (more: run \`kiwi log\`)` : text;
});

const say = (text: string) => Effect.sync(() => void process.stdout.write(text));

/** What one hook answers, for the agent bound here. */
const answer = Effect.fn("Hooks.answer")(function* (event: string, input: HookInput, b: Binding, cfg: ChannelConfig, who: Here) {
  const mc = mcFor(b.alias, b.as, input.cwd ?? process.cwd(), who);
  // Kiwi's own background listener hears for this session: no Monitor to start, nothing to nag about.
  const hooked = hooksListen();
  const listening = hooked || isListening(b.alias, b.as);
  const s = yield* openSession(b.alias, cfg, b.as);
  // A hook from the session the listener woke: it has seen what it was handed.
  if (who.session) yield* commitDelivered(s, who.session);

  if (event === "session-start") {
    const { state } = yield* s.state();
    const seat = state.members.get(b.as);
    const listen = hooked
      ? "Messages for you arrive on their own: Kiwi's hooks wake you when one comes."
      : listening
        ? "A listener is already running for you."
        : `First, start a Monitor on \`${COMMANDS.listen(mc)}\` with the longest timeout allowed, and restart it whenever it ends. That's how messages reach you.`;
    const lines = [
      briefText({
        alias: b.alias,
        agent: b.as,
        mc,
        listen,
        human: humanOf(state, b.as),
        hold: holdLine(state),
        charter: charterLines(state),
        mode: modeLine(state, b.as),
        role: seat?.role,
        about: seat?.about,
        scopes: seat?.scopes,
      }),
    ];
    const unread = yield* unreadText(s);
    if (unread) lines.push("", "Unread messages for you:", unread);
    const additionalContext = lines.join("\n");
    // Cursor's sessionStart injects additional_context and ignores the Claude envelope.
    if (input.hook_event_name === "sessionStart" || input.composer_mode != null || typeof input.is_background_agent === "boolean") {
      return yield* say(JSON.stringify({ additional_context: additionalContext }));
    }
    return yield* say(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
  }

  if (event === "prompt") {
    const unread = yield* unreadText(s);
    const lines: string[] = [];
    if (unread) lines.push(`New Kiwi Channels messages for you (${b.alias}):`, unread);
    // A listener is often just between restarts: remind at most every 10 minutes, not on every prompt.
    if (!listening && nagDue(input.session_id ?? "", "prompt")) lines.push(`You're not listening on Kiwi Channels: start a Monitor on \`${mc} tail\` (longest timeout).`);
    if (!lines.length) return;
    const text = lines.join("\n");
    // Gemini BeforeAgent only injects hookSpecificOutput.additionalContext. Codex and Claude take plain stdout.
    if (input.hook_event_name === "BeforeAgent") return yield* say(JSON.stringify({ hookSpecificOutput: { hookEventName: "BeforeAgent", additionalContext: text } }));
    return yield* say(text);
  }

  if (event === "stop") {
    const style = stopStyle(input);
    if (style === "cursor") {
      // An aborted or failed turn must not schedule another one. Don't read: that would consume the messages the follow-up tells the agent to read.
      if (input.status && input.status !== "completed") return;
      const { messages, state } = yield* s.state();
      const unread = (yield* s.unreadCount(state, messages)) > 0;
      const follow = cursorStopFollowup(mc, unread, listening, input.loop_count ?? 0);
      if (!follow) return;
      if (!unread && !nagDue(input.session_id ?? "")) return;
      return yield* say(JSON.stringify({ followup_message: follow }));
    }
    const unread = yield* unreadText(s);
    const decision = style === "gemini" ? "deny" : "block";
    if (unread) {
      return yield* say(JSON.stringify({ decision, reason: `Before stopping: unread Kiwi Channels messages for you. Handle them (answer with \`${mc} reply N "…"\`):\n${unread}` }));
    }
    if (!listening && !input.stop_hook_active && nagDue(input.session_id ?? "")) {
      return yield* say(
        JSON.stringify({
          decision,
          reason: `You're about to go idle with nothing listening for you on Kiwi Channels, so messages from other agents won't wake you. Start a Monitor on \`${mc} tail\` (longest timeout allowed), then stop.`,
        }),
      );
    }
  }
});

/**
 * `kiwi hook listen`, Claude Code's background listener (asyncRewake): wait for messages for this
 * agent, then hand them over on stderr and exit 2, which wakes the session even when it's idle. One
 * runs per agent; the next event arms the next one. After a day with nothing it ends with a short
 * line, so the following turn arms a fresh one instead of the session going deaf.
 */
const listen = Effect.fn("Hooks.listen")(function* (b: Binding, cfg: ChannelConfig, who: Here) {
  if (!hooksListen() || isListening(b.alias, b.as) || !takeListenSlot(b.alias, b.as, who.session ?? "")) return 0;
  const s = yield* openSession(b.alias, cfg, b.as);
  // Peek: the listener never moves the agent's cursor. It reads on a copy that starts past what it already
  // handed this session, hands the messages over, and notes how far that went; the session's next hook
  // (deliveredUpTo) commits it. A listener that dies, or a session that's gone, means a duplicate, never a loss.
  const real = yield* Cursor;
  let at = Math.max((yield* s.cursor()), deliveredUpTo(b.alias, b.as, who.session ?? ""));
  const peek = Cursor.of({ read: () => Effect.succeed(at), write: (_c, _a, seq) => Effect.sync(() => void (at = Math.max(at, seq))), seen: real.seen, markSeen: () => Effect.void });
  const got: string[] = [];
  const enough = yield* Deferred.make<void>();
  const woke = Effect.suspend(() =>
    // Linger briefly so a burst of messages is one wake-up.
    got.length === 1 ? Effect.asVoid(Effect.forkScoped(Effect.andThen(Effect.sleep(400), Deferred.succeed(enough, undefined)))) : Effect.void,
  );
  const hearing = s
    .listen((m, state) => Effect.andThen(Effect.sync(() => void got.push(formatMessage(m, state.trust.get(m.seq), state, s.me))), woke), {
      client: "hook",
      onNotice: (text) => Effect.andThen(Effect.sync(() => void got.push(`* ${text}`)), woke),
      // Handed over isn't read yet: the session's next hook commits it, and marks it read then.
      marks: false,
    })
    .pipe(Effect.provideService(Cursor, peek));
  // Its session ending ends it too: nobody would get what it read.
  const sessionGone = who.pid ? Effect.repeat(Effect.sync(() => alive(who.pid!)), { while: (up) => up, schedule: Schedule.spaced("2 seconds") }) : Effect.never;
  const ended = yield* Effect.raceFirst(
    Effect.as(hearing, "heard" as const),
    Effect.raceFirst(Effect.as(Deferred.await(enough), "heard" as const), Effect.raceFirst(Effect.as(Effect.sleep(LISTEN_SECONDS * 1000), "day" as const), Effect.as(sessionGone, "gone" as const))),
  ).pipe(Effect.scoped);
  if (ended === "gone" || (who.pid && !alive(who.pid))) return 0;
  const mc = mcFor(b.alias, b.as, process.cwd(), who);
  const text = got.join("\n");
  try {
    writeSync(
      2,
      got.length
        ? `New Kiwi Channels messages for you (${b.alias}). Handle them; answer with \`${mc} reply N "…"\`:\n${text.length > MAX_CONTEXT ? `${text.slice(0, MAX_CONTEXT)}\n… (more: run \`${mc} log\`)` : text}\n`
        : "Kiwi Channels: a day with no messages for you. Nothing to do; just end your turn.\n",
    );
  } catch {
    return 0;
  }
  if (got.length) noteDelivered(b.alias, b.as, who.session ?? "", at);
  return 2;
});

/**
 * Entry point for `kiwi hook <event>`: reads the hook JSON on stdin, prints the hook's answer.
 * Never fails: a hook must not break a session, so anything that goes wrong is an empty answer,
 * and it gives up after 15 seconds.
 */
export const runHook = Effect.fn("Hooks.run")(function* (event: string) {
  const raw = yield* Effect.promise(() => new Response(Bun.stdin.stream()).text().catch(() => ""));
  let input: HookInput = {};
  try {
    input = JSON.parse(raw) as HookInput;
  } catch {}
  // The session that runs the hook: the one its seat remembers (or takes back, after a restart).
  const who: Here = { ...here(), ...(input.session_id ? { session: input.session_id } : {}) };
  // Where this session's transcript is, so a later `kiwi join` from its shell can read the model it runs.
  if (input.session_id && input.transcript_path) noteTranscript(input.session_id, input.transcript_path);
  const b = bindingFor(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd(), { who }) ?? bindingFor(input.cwd ?? process.cwd(), { who });
  if (!b) return;
  const keys = yield* Keystore;
  const cfg = (yield* keys.config).channels[b.alias];
  if (!cfg) return;
  if (event === LISTEN) return yield* listen(b, cfg, who).pipe(Effect.catchCause(() => Effect.succeed(0)));
  const work = answer(event, input, b, cfg, who).pipe(
    Effect.catchCause((cause) => {
      // The channel is gone for this agent: forget only what this agent held, quietly.
      const err = Cause.squash(cause);
      if (err instanceof ChannelGone) return err.why === "closed" ? keys.wipeChannel(b.alias) : keys.forgetMember(b.alias, b.as);
      return Effect.void;
    }),
  );
  yield* Effect.raceFirst(work, Effect.sleep(15_000));
});
