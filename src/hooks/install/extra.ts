import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { kimiCodePid, mimoHere, piHere } from "../../ancestry.ts";
import { loadConfig } from "../../config.ts";
import type { NamedHookHarness } from "../../seats.ts";
import { isRecord, readJson, writeJson } from "../files.ts";
import { EVENTS, hookCommand, isOurHook, isOurHookCommand } from "../self.ts";
import { claudeHooksStatus, hooksInstalled, installHooks, uninstallHooks, withoutOurs, type Settings } from "./claude.ts";
import { editKimiConfig, kimiConfigInstalled } from "./kimi-toml.ts";
import { installMimo, mimoConfigRoot, mimoInstalled, mimoPluginPath, uninstallMimo } from "./mimo.ts";
import { installPi, piExtensionPath, piInstalled, piRoot, uninstallPi } from "./pi.ts";

export const EXTRA_HARNESSES = ["codex", "gemini", "cursor", "grok", "kimi", "pi", "mimo"] as const;
export type ExtraHarness = (typeof EXTRA_HARNESSES)[number];

const HARNESS_ENV: Record<ExtraHarness, string> = {
  codex: "KIWI_CODEX_DIR",
  gemini: "KIWI_GEMINI_DIR",
  cursor: "KIWI_CURSOR_DIR",
  grok: "KIWI_GROK_DIR",
  kimi: "KIWI_KIMI_DIR",
  pi: "KIWI_PI_DIR",
  mimo: "KIWI_MIMO_DIR",
};

const SESSION_ENV: Record<Exclude<ExtraHarness, "kimi" | "pi" | "mimo">, string> = {
  codex: "CODEX_THREAD_ID",
  gemini: "GEMINI_CLI",
  cursor: "CURSOR_AGENT",
  grok: "GROK_SESSION_ID",
};

function harnessRoot(h: ExtraHarness): string {
  const over = process.env[HARNESS_ENV[h]];
  if (over) return over;
  if (h === "codex") return process.env.CODEX_HOME || join(homedir(), ".codex");
  if (h === "gemini") return join(homedir(), ".gemini");
  if (h === "cursor") return join(homedir(), ".cursor");
  if (h === "kimi") return process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code");
  if (h === "pi") return piRoot();
  if (h === "mimo") return mimoConfigRoot();
  return join(homedir(), ".grok");
}

function insideHarness(h: ExtraHarness): boolean {
  if (h === "kimi") return kimiCodePid(process.env) !== null;
  if (h === "pi") return piHere(process.env) !== null;
  if (h === "mimo") return mimoHere(process.env) !== null;
  return !!process.env[SESSION_ENV[h]];
}

function harnessPath(h: ExtraHarness): string {
  if (h === "codex") return join(harnessRoot(h), "hooks.json");
  if (h === "gemini") return join(harnessRoot(h), "settings.json");
  if (h === "cursor") return join(harnessRoot(h), "hooks.json");
  if (h === "kimi") return join(harnessRoot(h), "config.toml");
  if (h === "pi") return piExtensionPath();
  if (h === "mimo") return mimoPluginPath();
  return join(harnessRoot(h), "hooks", "kiwi.json");
}

function harnessPresent(h: ExtraHarness): boolean {
  if (process.env[HARNESS_ENV[h]] !== undefined) return existsSync(harnessRoot(h));
  if (existsSync(harnessRoot(h))) return true;
  return !!Bun.which(h);
}

const GEMINI_EVENTS = { SessionStart: "session-start", BeforeAgent: "prompt", AfterAgent: "stop" } as const;

function installClaudeShaped(path: string, harness: NamedHookHarness, events: Record<string, string>, timeoutFor: (event: string) => number, matcher?: string): void {
  const s = readJson(path) as Settings;
  s.hooks ??= {};
  for (const [event, arg] of Object.entries(events)) {
    s.hooks[event] = [...withoutOurs(s.hooks[event]), { ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: hookCommand(arg, harness), timeout: timeoutFor(event) }] }];
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

function claudeShapedInstalled(path: string, harness: NamedHookHarness, events: Record<string, string>): boolean {
  if (!existsSync(path)) return false;
  const s = readJson(path) as Settings;
  return Object.entries(events).every(([event, arg]) => s.hooks?.[event]?.some((x) => x.hooks.some((h) => isOurHook(h.command, arg, harness))));
}

type CursorHook = { command?: string; timeout?: number; loop_limit?: number | null };
type CursorFile = { version?: number; hooks?: Record<string, CursorHook[]> } & Record<string, unknown>;

function cursorHooks(list: unknown): CursorHook[] {
  if (!Array.isArray(list)) return [];
  const items: unknown[] = list;
  return items.filter((h): h is CursorHook => !isRecord(h) || typeof h.command !== "string" || !isOurHookCommand(h.command));
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
  const has = (event: string, arg: string) => (s.hooks?.[event] ?? []).some((h) => isOurHook(h.command, arg));
  return has("sessionStart", "session-start") && has("stop", "stop");
}

export function installExtra(h: ExtraHarness): string {
  const path = harnessPath(h);
  if (h === "codex") installClaudeShaped(path, "codex", EVENTS, (event) => (event === "UserPromptSubmit" ? 20 : 30));
  else if (h === "gemini") installClaudeShaped(path, "gemini", GEMINI_EVENTS, (event) => (event === "BeforeAgent" ? 20_000 : 30_000), "*");
  else if (h === "cursor") installCursorFile(path);
  else if (h === "kimi") editKimiConfig(path, true);
  else if (h === "pi") installPi();
  else if (h === "mimo") installMimo();
  else installClaudeShaped(path, "grok", { Stop: "stop" }, () => 30);
  return path;
}

export function uninstallExtra(h: ExtraHarness): string {
  const path = harnessPath(h);
  if (h === "cursor") stripCursorFile(path);
  else if (h === "kimi") {
    if (existsSync(path)) editKimiConfig(path, false);
  } else if (h === "pi") uninstallPi();
  else if (h === "mimo") uninstallMimo();
  else stripClaudeShaped(path);
  return path;
}

export function extraInstalled(h: ExtraHarness): boolean {
  if (h === "cursor") return cursorFileInstalled(harnessPath(h));
  if (h === "gemini") return claudeShapedInstalled(harnessPath(h), "gemini", GEMINI_EVENTS);
  if (h === "grok") return claudeShapedInstalled(harnessPath(h), "grok", { Stop: "stop" });
  if (h === "kimi") return kimiConfigInstalled(harnessPath(h));
  if (h === "pi") return piInstalled();
  if (h === "mimo") return mimoInstalled();
  return claudeShapedInstalled(harnessPath(h), "codex", EVENTS);
}

const NAMED_HOOKS: readonly NamedHookHarness[] = ["codex", "gemini", "grok"];

function ourCommands(path: string): string[] {
  const hooks = readJson(path).hooks;
  const entries: unknown[] = isRecord(hooks) ? Object.values(hooks).flatMap((list) => (Array.isArray(list) ? list : [])) : [];
  return entries
    .flatMap((e) => (isRecord(e) && Array.isArray(e.hooks) ? e.hooks : []))
    .flatMap((h) => (isRecord(h) && typeof h.command === "string" && isOurHookCommand(h.command) ? [h.command] : []));
}

function unflagged(h: NamedHookHarness): boolean {
  return ourCommands(harnessPath(h)).some((command) => !command.includes(` --harness ${h} hook `));
}

export function migrateExtraHooks(): string[] {
  if (process.env.KIWI_NO_HOOKS) return [];
  try {
    const choice = loadConfig().harnessHooks ?? {};
    return NAMED_HOOKS.filter((h) => choice[h] !== "off" && unflagged(h)).map((h) => installExtra(h));
  } catch {
    // A hook must not fail over a hooks file it can't read or write.
    return [];
  }
}

export function extraHooksStatus(h: ExtraHarness): string {
  if (extraInstalled(h)) return "installed";
  if ((h === "codex" || h === "gemini" || h === "grok") && unflagged(h)) return "not installed (its hooks are from an older kiwi: kiwi hooks install)";
  return "not installed";
}

const HARNESS_LABEL: Record<ExtraHarness, string> = { codex: "Codex", gemini: "Gemini", cursor: "Cursor", grok: "Grok", kimi: "Kimi Code", pi: "Pi", mimo: "MiMoCode" };

export function autoInstallExtraHooks(): string | null {
  if (process.env.KIWI_NO_HOOKS) return null;
  const choice = loadConfig().harnessHooks ?? {};
  const wrote: string[] = [];
  for (const h of EXTRA_HARNESSES) {
    if (!insideHarness(h) || choice[h] === "off") continue;
    try {
      if (extraInstalled(h)) continue;
      wrote.push(`${HARNESS_LABEL[h]} hooks (${installExtra(h)})`);
    } catch {
      // A corrupt file must not fail join.
    }
  }
  return wrote.length ? wrote.join(", ") : null;
}

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

export function hooksStatus(): string {
  const choice = loadConfig().harnessHooks ?? {};
  const claude = loadConfig().claudeHooks === "off" && !hooksInstalled() ? "off" : claudeHooksStatus();
  const lines = [`claude: ${claude}`];
  for (const h of EXTRA_HARNESSES) {
    const status = extraHooksStatus(h);
    if (status !== "not installed") lines.push(`${h}: ${status}`);
    else if (choice[h] === "off") lines.push(`${h}: off`);
    else if (!harnessPresent(h)) lines.push(`${h}: not detected`);
    else lines.push(`${h}: not installed`);
  }
  return lines.join("\n");
}
