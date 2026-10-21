import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loadConfig } from "../../config.ts";
import { here } from "../../seats.ts";
import { EVENTS, hookCommand, isOurHook, isOurHookCommand, LISTEN, LISTEN_SECONDS, PERMISSION } from "../self.ts";

export const PERMISSION_EVENT = "PermissionRequest";
export const PERMISSION_SECONDS = 1_800;
export const PERMISSION_TOOLS = "Bash|Edit|Write|MultiEdit|NotebookEdit|WebFetch|mcp__.*";

function settingsPath(): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json");
}

type HookEntry = { matcher?: string; hooks: { type: "command"; command: string; timeout?: number; async?: boolean; asyncRewake?: boolean }[] };
export type Settings = { hooks?: Record<string, HookEntry[]> } & Record<string, unknown>;

function readSettings(): Settings {
  const p = settingsPath();
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Settings) : {};
}

function writeSettings(s: Settings): void {
  const p = settingsPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
}

export function withoutOurs(entries: HookEntry[] | undefined): HookEntry[] {
  return (entries ?? []).map((e) => ({ ...e, hooks: e.hooks.filter((h) => !isOurHookCommand(h.command)) })).filter((e) => e.hooks.length > 0);
}

export function installHooks(keepListen = false): string {
  const s = readSettings();
  s.hooks ??= {};
  const listen = keepListen || (claudeVersion() ? rewakeCapable() : listenHooksOf(s) !== "absent");
  for (const [event, arg] of Object.entries(EVENTS)) {
    s.hooks[event] = [
      ...withoutOurs(s.hooks[event]),
      { hooks: [{ type: "command", command: hookCommand(arg), timeout: event === "UserPromptSubmit" ? 20 : 30 }] },
      ...(listen ? [{ hooks: [{ type: "command" as const, command: hookCommand(LISTEN), async: true, asyncRewake: true, timeout: LISTEN_SECONDS + 60 }] }] : []),
    ];
  }
  s.hooks[PERMISSION_EVENT] = [...withoutOurs(s.hooks[PERMISSION_EVENT]), { matcher: PERMISSION_TOOLS, hooks: [{ type: "command", command: hookCommand(PERMISSION), timeout: PERMISSION_SECONDS }] }];
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
  return !!s.hooks?.[event]?.some((x) => x.hooks.some((h) => isOurHook(h.command, arg) && (arg !== LISTEN || (h.asyncRewake === true && (h.timeout ?? 0) > LISTEN_SECONDS))));
}

function hasListenEntry(s: Settings, event: string): boolean {
  return !!s.hooks?.[event]?.some((x) => x.hooks.some((h) => isOurHook(h.command, LISTEN)));
}

type ListenHooks = "current" | "stale" | "absent";

function listenHooksOf(s: Settings): ListenHooks {
  if (Object.keys(EVENTS).every((event) => hasHook(s, event, LISTEN))) return "current";
  return Object.keys(EVENTS).some((event) => hasListenEntry(s, event)) ? "stale" : "absent";
}

function claudeHooks(): { events: boolean; permission: boolean; listen: ListenHooks } {
  const s = readSettings();
  return { events: Object.entries(EVENTS).every(([event, arg]) => hasHook(s, event, arg)), permission: hasHook(s, PERMISSION_EVENT, PERMISSION), listen: listenHooksOf(s) };
}

function listenWanted(): boolean {
  return !claudeVersion() || rewakeCapable();
}

type ClaudeHooksState = "installed" | "installed-without-listen" | "missing" | "listen-missing" | "listen-stale";

function claudeHooksState(): ClaudeHooksState {
  const { events, permission, listen } = claudeHooks();
  if (!events || !permission) return "missing";
  switch (listen) {
    case "current":
      return "installed";
    case "stale":
      return "listen-stale";
    case "absent":
      if (!listenWanted()) return "installed";
      return claudeVersion() ? "listen-missing" : "installed-without-listen";
  }
}

export function claudeHooksStatus(): string {
  switch (claudeHooksState()) {
    case "installed":
      return "installed";
    case "installed-without-listen":
      return "installed, without the listening hooks (kiwi hooks install run inside Claude Code 2.1.296 or later adds them)";
    case "missing":
      return "not installed";
    case "listen-missing":
      return "not installed (the listening hooks are missing: kiwi hooks install)";
    case "listen-stale":
      return "not installed (its listening hooks are from an older kiwi or incomplete: kiwi hooks install)";
  }
}

export function migrateClaudeHooks(): string | null {
  if (process.env.KIWI_NO_HOOKS || here().harness !== "claude" || !listenWanted()) return null;
  try {
    if (loadConfig().claudeHooks === "off") return null;
    const { events, permission, listen } = claudeHooks();
    if (listen === "stale") return installHooks(true);
    return events && !permission ? installHooks(listen === "current") : null;
  } catch {
    return null;
  }
}

export function installedListenSeconds(): number | null {
  const timeouts = Object.keys(EVENTS).flatMap((event) =>
    (readSettings().hooks?.[event] ?? []).flatMap((x) => x.hooks.filter((h) => isOurHook(h.command, LISTEN) && typeof h.timeout === "number").map((h) => h.timeout as number)),
  );
  return timeouts.length ? Math.min(...timeouts) : null;
}

export function hooksInstalled(): boolean {
  const state = claudeHooksState();
  return state === "installed" || state === "installed-without-listen";
}

export const REWAKE_SINCE = [2, 1, 296] as const;

function claudeVersion(env: Record<string, string | undefined> = process.env): number[] | null {
  const m = /^claude-code_(\d+)-(\d+)-(\d+)_/.exec(env.AI_AGENT ?? "") ?? /[\\/](\d+)\.(\d+)\.(\d+)[\\/]claude(?:\.exe)?$/.exec(env.CLAUDE_CODE_EXECPATH ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function rewakeCapable(env: Record<string, string | undefined> = process.env): boolean {
  if (here(env).harness !== "claude") return false;
  const v = claudeVersion(env);
  return !!v && (v[0]! - REWAKE_SINCE[0] || v[1]! - REWAKE_SINCE[1] || v[2]! - REWAKE_SINCE[2]) >= 0;
}

export function hooksListen(env: Record<string, string | undefined> = process.env): boolean {
  if (here(env).harness !== "claude") return false;
  if (claudeVersion(env) && !rewakeCapable(env)) return false;
  return listenHooksInstalled();
}

export function listenHooksInstalled(): boolean {
  try {
    return claudeHooks().listen === "current";
  } catch {
    return false;
  }
}

export function autoInstallHooks(): string | null {
  if (process.env.KIWI_NO_HOOKS || here().harness !== "claude" || loadConfig().claudeHooks === "off") return null;
  try {
    return hooksInstalled() ? null : installHooks();
  } catch {
    return null;
  }
}
