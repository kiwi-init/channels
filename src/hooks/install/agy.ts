import { existsSync, rmSync } from "node:fs";
import { isRecord, readJson, writeJson } from "../files.ts";
import { hookCommand, isOurHook, isOurHookCommand } from "../self.ts";

const AGY_HOOK_NAME = "kiwi";

const AGY_HOOKS = [
  { event: "SessionStart", arg: "session-start", timeout: 20 },
  { event: "PreInvocation", arg: "prompt", timeout: 20 },
  { event: "Stop", arg: "stop", timeout: 30 },
] as const;

type AgyHandler = { type: "command"; command: string; timeout: number };

function handlers(list: unknown): Record<string, unknown>[] {
  if (!Array.isArray(list)) return [];
  const items: unknown[] = list;
  return items.flatMap((x): Record<string, unknown>[] => {
    if (!isRecord(x)) return [];
    if (Array.isArray(x.hooks)) return handlers(x.hooks);
    return [x];
  });
}

function commands(entry: Record<string, unknown>): string[] {
  return Object.values(entry)
    .flatMap(handlers)
    .flatMap((h) => (typeof h.command === "string" ? [h.command] : []));
}

function someoneElses(entry: unknown): boolean {
  if (entry === undefined) return false;
  if (!isRecord(entry)) return true;
  return commands(entry).some((c) => !isOurHookCommand(c));
}

export function installAgy(path: string): void {
  const s = readJson(path);
  if (someoneElses(s[AGY_HOOK_NAME])) throw new Error(`${path} already has a hook named "${AGY_HOOK_NAME}" that isn't Kiwi's; rename it and install again`);
  s[AGY_HOOK_NAME] = Object.fromEntries(AGY_HOOKS.map((h): [string, AgyHandler[]] => [h.event, [{ type: "command", command: hookCommand(h.arg, "agy"), timeout: h.timeout }]]));
  writeJson(path, s);
}

export function uninstallAgy(path: string): void {
  if (!existsSync(path)) return;
  const s = readJson(path);
  if (s[AGY_HOOK_NAME] === undefined || someoneElses(s[AGY_HOOK_NAME])) return;
  delete s[AGY_HOOK_NAME];
  if (!Object.keys(s).length) {
    rmSync(path, { force: true });
    return;
  }
  writeJson(path, s);
}

export function agyInstalled(path: string): boolean {
  if (!existsSync(path)) return false;
  const entry = readJson(path)[AGY_HOOK_NAME];
  if (!isRecord(entry) || entry.enabled === false) return false;
  return AGY_HOOKS.every((h) => handlers(entry[h.event]).some((x) => isOurHook(x.command, h.arg, "agy")));
}
