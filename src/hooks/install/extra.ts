import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { kimiCodePid, piHere } from "../../ancestry.ts";
import { loadConfig } from "../../config.ts";
import { isRecord, readJson, writeJson } from "../files.ts";
import { EVENTS, hookCommand, isOurHook, isOurHookCommand } from "../self.ts";
import { hooksInstalled, installHooks, uninstallHooks, withoutOurs, type Settings } from "./claude.ts";
import { editKimiConfig, kimiConfigInstalled } from "./kimi-toml.ts";
import { installPi, piExtensionPath, piInstalled, piRoot, uninstallPi } from "./pi.ts";

export const EXTRA_HARNESSES = ["codex", "gemini", "cursor", "grok", "kimi", "pi"] as const;
export type ExtraHarness = (typeof EXTRA_HARNESSES)[number];

const HARNESS_ENV: Record<ExtraHarness, string> = {
  codex: "KIWI_CODEX_DIR",
  gemini: "KIWI_GEMINI_DIR",
  cursor: "KIWI_CURSOR_DIR",
  grok: "KIWI_GROK_DIR",
  kimi: "KIWI_KIMI_DIR",
  pi: "KIWI_PI_DIR",
};

const SESSION_ENV: Record<Exclude<ExtraHarness, "kimi" | "pi">, string> = {
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
  if (h === "kimi") return process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code");
  if (h === "pi") return piRoot();
  return join(homedir(), ".grok");
}

function insideHarness(h: ExtraHarness): boolean {
  if (h === "kimi") return kimiCodePid(process.env) !== null;
  if (h === "pi") return piHere(process.env) !== null;
  return !!process.env[SESSION_ENV[h]];
}

function harnessPath(h: ExtraHarness): string {
  if (h === "codex") return join(harnessRoot(h), "hooks.json");
  if (h === "gemini") return join(harnessRoot(h), "settings.json");
  if (h === "cursor") return join(harnessRoot(h), "hooks.json");
  if (h === "kimi") return join(harnessRoot(h), "config.toml");
  if (h === "pi") return piExtensionPath();
  return join(harnessRoot(h), "hooks", "kiwi.json");
}

function harnessPresent(h: ExtraHarness): boolean {
  if (process.env[HARNESS_ENV[h]] !== undefined) return existsSync(harnessRoot(h));
  if (existsSync(harnessRoot(h))) return true;
  return !!Bun.which(h);
}

const GEMINI_EVENTS = { SessionStart: "session-start", BeforeAgent: "prompt", AfterAgent: "stop" } as const;

function installClaudeShaped(path: string, events: Record<string, string>, timeoutFor: (event: string) => number, matcher?: string): void {
  const s = readJson(path) as Settings;
  s.hooks ??= {};
  for (const [event, arg] of Object.entries(events)) {
    s.hooks[event] = [...withoutOurs(s.hooks[event]), { ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: hookCommand(arg), timeout: timeoutFor(event) }] }];
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
  return Object.entries(events).every(([event, arg]) => s.hooks?.[event]?.some((x) => x.hooks.some((h) => isOurHook(h.command, arg))));
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
  if (h === "codex") installClaudeShaped(path, EVENTS, (event) => (event === "UserPromptSubmit" ? 20 : 30));
  else if (h === "gemini") installClaudeShaped(path, GEMINI_EVENTS, (event) => (event === "BeforeAgent" ? 20_000 : 30_000), "*");
  else if (h === "cursor") installCursorFile(path);
  else if (h === "kimi") editKimiConfig(path, true);
  else if (h === "pi") installPi();
  else installClaudeShaped(path, { Stop: "stop" }, () => 30);
  return path;
}

export function uninstallExtra(h: ExtraHarness): string {
  const path = harnessPath(h);
  if (h === "cursor") stripCursorFile(path);
  else if (h === "kimi") {
    if (existsSync(path)) editKimiConfig(path, false);
  } else if (h === "pi") uninstallPi();
  else stripClaudeShaped(path);
  return path;
}

export function extraInstalled(h: ExtraHarness): boolean {
  if (h === "cursor") return cursorFileInstalled(harnessPath(h));
  if (h === "gemini") return claudeShapedInstalled(harnessPath(h), GEMINI_EVENTS);
  if (h === "grok") return claudeShapedInstalled(harnessPath(h), { Stop: "stop" });
  if (h === "kimi") return kimiConfigInstalled(harnessPath(h));
  if (h === "pi") return piInstalled();
  return claudeShapedInstalled(harnessPath(h), EVENTS);
}

const HARNESS_LABEL: Record<ExtraHarness, string> = { codex: "Codex", gemini: "Gemini", cursor: "Cursor", grok: "Grok", kimi: "Kimi Code", pi: "Pi" };

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
