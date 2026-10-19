import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loadConfig } from "../../config.ts";
import { here } from "../../seats.ts";
import { EVENTS, hookCommand, isOurHook, isOurHookCommand, LISTEN, LISTEN_SECONDS } from "../self.ts";

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

export function installHooks(): string {
  const s = readSettings();
  s.hooks ??= {};
  const listen = claudeVersion() ? rewakeCapable() : Object.keys(EVENTS).every((event) => hasListenEntry(s, event));
  for (const [event, arg] of Object.entries(EVENTS)) {
    s.hooks[event] = [
      ...withoutOurs(s.hooks[event]),
      { hooks: [{ type: "command", command: hookCommand(arg), timeout: event === "UserPromptSubmit" ? 20 : 30 }] },
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
  return !!s.hooks?.[event]?.some((x) => x.hooks.some((h) => isOurHook(h.command, arg) && (arg !== LISTEN || (h.asyncRewake === true && (h.timeout ?? 0) > LISTEN_SECONDS))));
}

function hasListenEntry(s: Settings, event: string): boolean {
  return !!s.hooks?.[event]?.some((x) => x.hooks.some((h) => isOurHook(h.command, LISTEN)));
}

function staleListen(s: Settings): boolean {
  return Object.keys(EVENTS).some((event) => hasListenEntry(s, event) && !hasHook(s, event, LISTEN));
}

export function claudeHooksStatus(): string {
  if (hooksInstalled()) return "installed";
  return staleListen(readSettings()) ? "not installed (its listen hook is from an older kiwi: kiwi hooks install)" : "not installed";
}

export function migrateListenHooks(): string | null {
  if (process.env.KIWI_NO_HOOKS || here().harness !== "claude" || (claudeVersion() && !rewakeCapable())) return null;
  try {
    if (loadConfig().claudeHooks === "off") return null;
    return staleListen(readSettings()) ? installHooks() : null;
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
  const s = readSettings();
  const listen = claudeVersion() ? rewakeCapable() : false;
  return !staleListen(s) && Object.entries(EVENTS).every(([event, arg]) => hasHook(s, event, arg) && (!listen || hasHook(s, event, LISTEN)));
}

const REWAKE_SINCE = [2, 1, 296] as const;

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
    const s = readSettings();
    return Object.keys(EVENTS).every((event) => hasHook(s, event, LISTEN));
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
